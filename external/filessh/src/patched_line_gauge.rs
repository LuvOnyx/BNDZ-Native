use ratatui::{
    buffer::Buffer,
    layout::Rect,
    style::{Color, Style, Styled},
    symbols::{self},
    text::Line,
    widgets::{Block, Widget, WidgetRef, block::BlockExt},
};
/// A compact widget to display a progress bar over a single thin line.
///
/// This can be useful to indicate the progression of a task, like a download.
///
/// A `LineGauge` renders a thin line filled according to the value given to [`LineGauge::ratio`].
/// Unlike [`Gauge`], only the width can be defined by the [rendering](Widget::render) [`Rect`]. The
/// height is always 1.
///
/// The associated label is always left-aligned. If not set with [`LineGauge::label`], the label is
/// the percentage of the bar filled.
///
/// You can also set the symbols used to draw the bar with [`LineGauge::line_set`].
///
/// To style the gauge line use [`LineGauge::filled_style`] and [`LineGauge::unfilled_style`] which
/// let you pick a color for foreground (i.e. line) and background of the filled and unfilled part
/// of gauge respectively.
///
/// # Examples:
///
/// ```
/// use ratatui::{
///     style::{Style, Stylize},
///     symbols,
///     widgets::{Block, LineGauge},
/// };
///
/// LineGauge::default()
///     .block(Block::bordered().title("Progress"))
///     .filled_style(Style::new().white().on_black().bold())
///     .line_set(symbols::line::THICK)
///     .ratio(0.4);
/// ```
///
/// # See also
///
/// - [`Gauge`] for bigger, higher precision and more configurable progress bar
#[derive(Debug, Default, Clone, PartialEq)]
pub struct LineGauge<'a> {
    block: Option<Block<'a>>,
    ratio: f64,
    label: Option<Line<'a>>,
    line_set: symbols::line::Set,
    style: Style,
    filled_style: Style,
    unfilled_style: Style,
}

#[allow(dead_code)]
impl<'a> LineGauge<'a> {
    /// Surrounds the `LineGauge` with a [`Block`].
    #[must_use = "method moves the value of self and returns the modified value"]
    pub fn block(mut self, block: Block<'a>) -> Self {
        self.block = Some(block);
        self
    }

    /// Sets the bar progression from a ratio (float).
    ///
    /// `ratio` is the ratio between filled bar over empty bar (i.e. `3/4` completion is `0.75`).
    /// This is more easily seen as a floating point percentage (e.g. 42% = `0.42`).
    ///
    /// # Panics
    ///
    /// This method panics if `ratio` is **not** between 0 and 1 inclusively.
    #[must_use = "method moves the value of self and returns the modified value"]
    pub fn ratio(mut self, ratio: f64) -> Self {
        assert!(
            (0.0..=1.0).contains(&ratio),
            "Ratio should be between 0 and 1 inclusively."
        );
        self.ratio = ratio;
        self
    }

    /// Sets the characters to use for the line.
    ///
    /// # See also
    ///
    /// See [`symbols::line::Set`] for more information. Predefined sets are also available, see
    /// [`NORMAL`](symbols::line::NORMAL), [`DOUBLE`](symbols::line::DOUBLE) and
    /// [`THICK`](symbols::line::THICK).
    #[must_use = "method moves the value of self and returns the modified value"]
    pub const fn line_set(mut self, set: symbols::line::Set) -> Self {
        self.line_set = set;
        self
    }

    /// Sets the label to display.
    ///
    /// With `LineGauge`, labels are only on the left, see [`Gauge`] for a centered label.
    /// If the label is not defined, it is the percentage filled.
    #[must_use = "method moves the value of self and returns the modified value"]
    pub fn label<T>(mut self, label: T) -> Self
    where
        T: Into<Line<'a>>,
    {
        self.label = Some(label.into());
        self
    }

    /// Sets the widget style.
    ///
    /// `style` accepts any type that is convertible to [`Style`] (e.g. [`Style`], [`Color`], or
    /// your own type that implements [`Into<Style>`]).
    ///
    /// This will style everything except the bar itself, so basically the block (if any) and
    /// background.
    #[must_use = "method moves the value of self and returns the modified value"]
    pub fn style<S: Into<Style>>(mut self, style: S) -> Self {
        self.style = style.into();
        self
    }

    /// Sets the style of the bar.
    ///
    /// `style` accepts any type that is convertible to [`Style`] (e.g. [`Style`], [`Color`], or
    /// your own type that implements [`Into<Style>`]).
    #[deprecated(
        since = "0.27.0",
        note = "You should use `LineGauge::filled_style` instead."
    )]
    #[must_use = "method moves the value of self and returns the modified value"]
    pub fn gauge_style<S: Into<Style>>(mut self, style: S) -> Self {
        let style: Style = style.into();

        // maintain backward compatibility, which used the background color of the style as the
        // unfilled part of the gauge and the foreground color as the filled part of the gauge
        let filled_color = style.fg.unwrap_or(Color::Reset);
        let unfilled_color = style.bg.unwrap_or(Color::Reset);
        self.filled_style = style.fg(filled_color).bg(Color::Reset);
        self.unfilled_style = style.fg(unfilled_color).bg(Color::Reset);
        self
    }

    /// Sets the style of filled part of the bar.
    ///
    /// `style` accepts any type that is convertible to [`Style`] (e.g. [`Style`], [`Color`], or
    /// your own type that implements [`Into<Style>`]).
    #[must_use = "method moves the value of self and returns the modified value"]
    pub fn filled_style<S: Into<Style>>(mut self, style: S) -> Self {
        self.filled_style = style.into();
        self
    }

    /// Sets the style of the unfilled part of the bar.
    ///
    /// `style` accepts any type that is convertible to [`Style`] (e.g. [`Style`], [`Color`], or
    /// your own type that implements [`Into<Style>`]).
    #[must_use = "method moves the value of self and returns the modified value"]
    pub fn unfilled_style<S: Into<Style>>(mut self, style: S) -> Self {
        self.unfilled_style = style.into();
        self
    }
}

impl Widget for LineGauge<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        self.render_ref(area, buf);
    }
}

impl WidgetRef for LineGauge<'_> {
    fn render_ref(&self, area: Rect, buf: &mut Buffer) {
        buf.set_style(area, self.style);
        self.block.render_ref(area, buf);
        let gauge_area = self.block.inner_if_some(area);
        if gauge_area.is_empty() {
            return;
        }

        let ratio = self.ratio;
        let default_label = Line::from(format!("{:.0}%", ratio * 100.0));
        let label = self.label.as_ref().unwrap_or(&default_label);
        let (col, row) = buf.set_line(gauge_area.left(), gauge_area.top(), label, gauge_area.width);
        buf[(col, row)]
            .set_symbol("[")
            .set_style(self.unfilled_style);
        buf[(gauge_area.right(), row)]
            .set_symbol("]")
            .set_style(self.unfilled_style);
        let start = col + 1;
        if start >= gauge_area.right() - 1 {
            return;
        }

        let end = start
            + (f64::from(gauge_area.right().saturating_sub(start)) * self.ratio).floor() as u16;
        for col in start..end {
            buf[(col, row)]
                .set_symbol(self.line_set.horizontal)
                .set_style(self.filled_style);
        }
        for col in end..gauge_area.right() {
            buf[(col, row)]
                .set_symbol(".")
                .set_style(self.unfilled_style);
        }
    }
}

impl<'a> Styled for LineGauge<'a> {
    type Item = Self;

    fn style(&self) -> Style {
        self.style
    }

    fn set_style<S: Into<Style>>(self, style: S) -> Self::Item {
        self.style(style)
    }
}
