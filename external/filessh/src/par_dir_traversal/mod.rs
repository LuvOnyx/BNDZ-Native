#![allow(dead_code)]
/// Inspired by the Parallel Walker in the
/// `ignore` crate
use color_eyre::eyre::Result;
use crossbeam::deque::{Stealer, Worker as Deque};
use futures::future::join_all; // add at top of file if not present
use russh_sftp::{
    client::{SftpSession, fs::Metadata},
    protocol::FileType,
};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
use tokio::task::JoinHandle;

use crate::files::FileEntry;

pub type Filter = Arc<dyn Fn(&FileEntry) -> bool + Send + Sync + 'static>;

#[allow(dead_code)]
pub struct WalkParallel {
    pub filter: Filter,
    pub path: PathBuf,
    pub max_depth: Option<usize>,
    pub min_depth: Option<usize>,
    pub threads: usize,
    pub sftp: Arc<SftpSession>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WalkState {
    Continue,
    Quit,
}

struct FnBuilder<F> {
    builder: F,
}

pub trait ParallelVisitorBuilder<'s>: Send {
    fn build(&mut self) -> Box<dyn ParallelVisitor + 's>;
}

impl<'s, P: ParallelVisitorBuilder<'s>> ParallelVisitorBuilder<'s> for &mut P {
    fn build(&mut self) -> Box<dyn ParallelVisitor + 's> {
        (**self).build()
    }
}

impl<'s, F: FnMut() -> FnVisitor<'s> + Send> ParallelVisitorBuilder<'s> for FnBuilder<F> {
    fn build(&mut self) -> Box<dyn ParallelVisitor + 's> {
        let visitor = (self.builder)();
        Box::new(FnVisitorImp { visitor })
    }
}

pub trait ParallelVisitor: Send {
    fn visit(&mut self, entry: Result<FileEntry>) -> WalkState;
}

type FnVisitor<'s> = Box<dyn FnMut(Result<FileEntry>) -> WalkState + Send + 's>;

struct FnVisitorImp<'s> {
    visitor: FnVisitor<'s>,
}
impl<'s> ParallelVisitor for FnVisitorImp<'s> {
    fn visit(&mut self, entry: Result<FileEntry>) -> WalkState {
        (self.visitor)(entry)
    }
}

impl WalkParallel {
    pub async fn run<F>(self, mkf: F)
    where
        F: FnMut() -> FnVisitor<'static> + Send,
    {
        self.visit(&mut FnBuilder { builder: mkf }).await
    }

    pub async fn visit(self, builder: &mut dyn ParallelVisitorBuilder<'static>) {
        let threads = self.threads();

        // --- Create the root work item ------------------------------------
        let root_path = self.path.display().to_string();

        // Build a synthetic root FileEntry (a directory)
        let attr = Metadata::empty();
        let root_entry = FileEntry::from_file(root_path.clone(), FileType::Dir, attr);

        // The traversal starts at the root path (cwd = root_path)
        let init: Vec<Message> = vec![Message::Work(Work {
            entry: root_entry,
            cwd: root_path.clone(),
        })];

        // --- Create per-thread work-stealing stacks -----------------------
        let stacks = Stack::new_for_each_thread(threads, init);

        // --- Shared state -------------------------------------------------
        let quit_now = Arc::new(AtomicBool::new(false));
        let active_workers = Arc::new(AtomicUsize::new(threads));

        // --- Build all visitors *before* spawning -------------------------
        let visitors: Vec<Box<dyn ParallelVisitor + 'static>> =
            (0..threads).map(|_| builder.build()).collect();

        // --- Spawn workers ------------------------------------------------
        let mut handles: Vec<JoinHandle<()>> = Vec::with_capacity(threads);

        for (stack, visitor) in stacks.into_iter().zip(visitors.into_iter()) {
            let worker = Woker {
                visitor,
                stack,
                quit_now: Arc::clone(&quit_now),
                active_workers: Arc::clone(&active_workers),
                max_depth: self.max_depth,
                filter: Some(self.filter.clone()),
                sftp: Arc::clone(&self.sftp),
            };

            // Each worker runs concurrently; owns its visitor and stack
            handles.push(tokio::spawn(async move {
                worker.run().await;
            }));
        }

        // --- Wait for all workers to finish -------------------------------
        let _ = join_all(handles).await;
    }

    fn threads(&self) -> usize {
        if self.threads == 0 {
            std::thread::available_parallelism()
                .map_or(1, |n| n.get())
                .min(12)
        } else {
            self.threads
        }
    }
}

enum Message {
    /// A work item corresponds to a directory that should be descended into.
    /// Work items for entries that should be skipped or ignored should not
    /// be produced.
    Work(Work),
    /// This instruction indicates that the worker should quit.
    Quit,
}

pub struct Work {
    entry: FileEntry,
    cwd: String, // full remote path to the *entry*
}

impl Work {
    pub async fn read_dir(&self, sftp: Arc<SftpSession>) -> Result<Vec<Work>> {
        // Determine the directory path we should read.
        // For the root, `cwd` is already the directory path.
        let dir_path = if self.entry.is_dir() {
            if self.cwd.ends_with(self.entry.name()) {
                // If cwd already ends with the entry name, use it as-is
                self.cwd.clone()
            } else {
                // Otherwise, join cwd + entry name
                format!("{}/{}", self.cwd, self.entry.name())
            }
        } else {
            // Not a directory, nothing to read
            return Ok(vec![]);
        };

        // Read entries via SFTP
        let entries = sftp.read_dir(dir_path.clone()).await?;

        let works = entries
            .map(|child| Work {
                entry: FileEntry::from(child),
                cwd: dir_path.clone(), // new base for children
            })
            .collect::<Vec<_>>();

        Ok(works)
    }
}

/// A work-stealing stack.
#[derive(Debug)]
struct Stack {
    /// This thread's index.
    index: usize,
    /// The thread-local stack.
    deque: Deque<Message>,
    /// The work stealers.
    stealers: Arc<[Stealer<Message>]>,
}

impl Stack {
    /// Create a work-stealing stack for each thread. The given messages
    /// correspond to the initial paths to start the search at. They will
    /// be distributed automatically to each stack in a round-robin fashion.
    fn new_for_each_thread(threads: usize, init: Vec<Message>) -> Vec<Stack> {
        // Using new_lifo() ensures each worker operates depth-first, not
        // breadth-first. We do depth-first because a breadth first traversal
        // on wide directories with a lot of gitignores is disastrous (for
        // example, searching a directory tree containing all of crates.io).
        let deques: Vec<Deque<Message>> = std::iter::repeat_with(Deque::new_lifo)
            .take(threads)
            .collect();
        let stealers =
            Arc::<[Stealer<Message>]>::from(deques.iter().map(Deque::stealer).collect::<Vec<_>>());
        let stacks: Vec<Stack> = deques
            .into_iter()
            .enumerate()
            .map(|(index, deque)| Stack {
                index,
                deque,
                stealers: stealers.clone(),
            })
            .collect();
        // Distribute the initial messages, reverse the order to cancel out
        // the other reversal caused by the inherent LIFO processing of the
        // per-thread stacks which are filled here.
        init.into_iter()
            .rev()
            .zip(stacks.iter().cycle())
            .for_each(|(m, s)| s.push(m));
        stacks
    }

    /// Push a message.
    fn push(&self, msg: Message) {
        self.deque.push(msg);
    }

    /// Pop a message.
    fn pop(&self) -> Option<Message> {
        self.deque.pop().or_else(|| self.steal())
    }

    /// Steal a message from another queue.
    fn steal(&self) -> Option<Message> {
        // For fairness, try to steal from index + 1, index + 2, ... len - 1,
        // then wrap around to 0, 1, ... index - 1.
        let (left, right) = self.stealers.split_at(self.index);
        // Don't steal from ourselves
        let right = &right[1..];

        right
            .iter()
            .chain(left.iter())
            .map(|s| s.steal_batch_and_pop(&self.deque))
            .find_map(|s| s.success())
    }
}

pub struct Woker<'a> {
    visitor: Box<dyn ParallelVisitor + 'a>,
    stack: Stack,
    quit_now: Arc<AtomicBool>,
    active_workers: Arc<AtomicUsize>,
    max_depth: Option<usize>,
    filter: Option<Filter>,
    sftp: Arc<SftpSession>,
}

impl WalkState {
    fn is_continue(&self) -> bool {
        *self == WalkState::Continue
    }

    fn is_quit(&self) -> bool {
        *self == WalkState::Quit
    }
}

impl<'a> Woker<'a> {
    pub async fn run(mut self) {
        while let Some(work) = self.get_work() {
            if let WalkState::Quit = self.run_one(work).await {
                self.quit_now();
            }
        }
    }

    pub async fn run_one(&mut self, work: Work) -> WalkState {
        let sftp = Arc::clone(&self.sftp);
        let readdir = work.read_dir(sftp).await;

        // --- Create a new FileEntry with an absolute name -----------------
        let abs_entry = {
            let path = if work.cwd.ends_with(work.entry.name()) {
                work.cwd.clone()
            } else {
                PathBuf::from(&work.cwd)
                    .join(work.entry.name())
                    .to_string_lossy()
                    .to_string()
            };

            // Rebuild FileEntry, preserving its metadata but using abs path as the name
            FileEntry::from_file(path, FileType::Dir, work.entry.attributes.clone())
        };

        // Visit the current file/directory with absolute name
        let state = self.visitor.visit(Ok(abs_entry));
        if !state.is_continue() {
            return state;
        }

        // --- Process directory contents -----------------------------------
        let readdir = match readdir {
            Ok(readdir) => readdir,
            Err(err) => return self.visitor.visit(Err(err)),
        };

        for child_work in readdir {
            let state = self.generate_work(child_work).await;
            if state.is_quit() {
                return state;
            }
        }

        WalkState::Continue
    }

    pub async fn generate_work(&mut self, work: Work) -> WalkState {
        // Push this new work onto the queue
        self.send(work);
        WalkState::Continue
    }

    fn get_work(&mut self) -> Option<Work> {
        let mut value = self.recv();
        loop {
            // Simulate a priority channel: If quit_now flag is set, we can
            // receive only quit messages.
            if self.is_quit_now() {
                value = Some(Message::Quit)
            }
            match value {
                Some(Message::Work(work)) => {
                    return Some(work);
                }
                Some(Message::Quit) => {
                    // Repeat quit message to wake up sleeping threads, if
                    // any. The domino effect will ensure that every thread
                    // will quit.
                    self.send_quit();
                    return None;
                }
                None => {
                    if self.deactivate_worker() == 0 {
                        // If deactivate_worker() returns 0, every worker thread
                        // is currently within the critical section between the
                        // acquire in deactivate_worker() and the release in
                        // activate_worker() below.  For this to happen, every
                        // worker's local deque must be simultaneously empty,
                        // meaning there is no more work left at all.
                        self.send_quit();
                        return None;
                    }
                    // Wait for next `Work` or `Quit` message.
                    loop {
                        if let Some(v) = self.recv() {
                            self.activate_worker();
                            value = Some(v);
                            break;
                        }
                        // Our stack isn't blocking. Instead of burning the
                        // CPU waiting, we let the thread sleep for a bit. In
                        // general, this tends to only occur once the search is
                        // approaching termination.
                        let dur = std::time::Duration::from_millis(1);
                        std::thread::sleep(dur);
                    }
                }
            }
        }
    }

    /// Indicates that all workers should quit immediately.
    fn quit_now(&self) {
        self.quit_now.store(true, Ordering::SeqCst);
    }

    /// Returns true if this worker should quit immediately.
    fn is_quit_now(&self) -> bool {
        self.quit_now.load(Ordering::SeqCst)
    }

    /// Send work.
    fn send(&self, work: Work) {
        self.stack.push(Message::Work(work));
    }

    /// Send a quit message.
    fn send_quit(&self) {
        self.stack.push(Message::Quit);
    }

    /// Receive work.
    fn recv(&self) -> Option<Message> {
        self.stack.pop()
    }

    /// Deactivates a worker and returns the number of currently active workers.
    fn deactivate_worker(&self) -> usize {
        self.active_workers.fetch_sub(1, Ordering::Acquire) - 1
    }

    /// Reactivates a worker.
    fn activate_worker(&self) {
        self.active_workers.fetch_add(1, Ordering::Release);
    }
}
