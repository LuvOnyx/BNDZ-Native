import express from "express";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json({ limit: "50mb" }));

  // Intelligent Tools Endpoint
  app.post("/api/gemini", async (req, res) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const { prompt, files, intent } = req.body;
      
      if (intent === 'organize') {
         const sysPrompt = `You are a professional file organization AI. 
The user wants to organize these files: ${JSON.stringify(files)}.
Analyze their names/extensions and group them into logical subdirectories (e.g., 'Images', 'Documents', 'Project X').
Output EXACTLY valid JSON matching this schema:
{ "operations": [ { "file": "original_name.ext", "newFolder": "FolderName" } ] }`;
         
         const resp = await ai.models.generateContent({
             model: "gemini-2.5-flash",
             contents: sysPrompt,
             config: { responseMimeType: "application/json" }
         });
         
         res.json({ result: JSON.parse(resp.text || "{}") });
      } else {
         const resp = await ai.models.generateContent({
             model: "gemini-2.5-flash",
             contents: prompt || "Hello",
         });
         res.json({ text: resp.text });
      }
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // REAL FILESYSTEM BACKEND ROUTES
  app.post('/api/fs/list', async (req, res) => {
      try {
          const dirPath = req.body.path || process.cwd();
          
          if (dirPath === '/' || dirPath === '') {
              // Root return drives simulation
              return res.json([
                  { name: '/', type: 'directory', path: '/', size: 0, modified: Date.now() }
              ]);
          }

          const resolvedPath = path.resolve(dirPath);
          const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
          const result = [];

          for (const entry of entries) {
              try {
                  const stat = await fs.stat(path.join(resolvedPath, entry.name));
                  result.push({
                      id: path.join(resolvedPath, entry.name),
                      name: entry.name,
                      type: entry.isDirectory() ? 'directory' : 'file',
                      size: stat.size,
                      modified: stat.mtimeMs,
                      extension: entry.isDirectory() ? '' : path.extname(entry.name).replace('.', '')
                  });
              } catch (err) {
                  // Skip items that error on stat (e.g. broken symlinks)
              }
          }
          res.json({ items: result, parent: path.dirname(resolvedPath) });
      } catch (err: any) {
          res.status(500).json({ error: err.message });
      }
  });

  app.post('/api/fs/read', async (req, res) => {
      try {
          const filePath = req.body.path;
          if (!filePath) return res.status(400).json({ error: "No path" });
          const content = await fs.readFile(path.resolve(filePath), 'utf-8');
          res.json({ content });
      } catch (err: any) {
          res.status(500).json({ error: err.message });
      }
  });

  // Local stream
  app.get('/local-stream/*', async (req, res) => {
      try {
          const raw = decodeURIComponent(req.params[0] || '');
          const normalized = raw.replace(/\//g, path.sep);
          const filePath = /^[A-Za-z]:/.test(normalized)
              ? normalized
              : path.resolve('/' + normalized);
          if (!fsSync.existsSync(filePath)) {
              res.status(404).send('Not Found');
              return;
          }
          res.setHeader('Accept-Ranges', 'bytes');
          res.sendFile(filePath);
      } catch (err) {
          res.status(404).send("Not Found");
      }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
