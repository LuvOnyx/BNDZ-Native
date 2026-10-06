# Third-party attributions — BNDZ LAN Share

## copyparty (MIT)

- Upstream: https://github.com/9001/copyparty
- License: MIT (Copyright (c) 2019 ed <oss@ocv.me>)
- What we used: product/architecture ideas only for BNDZ's own LAN HTTP folder sharer
  (read-only volume share, tokenized URL path, LAN bind, QR/link UX, honest stop).
- What we did NOT vendor: Mutagen, FFmpeg/FFprobe, GPL helpers, or shipping `copyparty.exe` / Python runtime as the product.
- Implementation: native .NET `HttpListener` inside BNDZBackend (`Services/LanShare/`).

The MIT license text from upstream is included below for attribution of studied patterns.

```
MIT License

Copyright (c) 2019 ed <oss@ocv.me>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
