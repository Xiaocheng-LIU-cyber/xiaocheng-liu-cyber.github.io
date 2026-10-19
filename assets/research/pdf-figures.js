/**
 * Renders the repository's original single-page research PDFs into responsive
 * canvases. Unlike embedded browser PDF viewers, this has no grey letterboxing
 * or browser-specific PDF toolbar/padding.
 */
const canvases = [...document.querySelectorAll("canvas[data-pdf-src]")];
if (canvases.length) {
  let pdfjs;
  try {
    pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
  } catch (error) {
    console.warn("Could not load the PDF renderer:", error);
    for (const canvas of canvases) {
      showError(canvas, "PDF preview unavailable. Please refresh or try another browser.");
    }
  }

  if (pdfjs) {
    for (const canvas of canvases) {
      setupPdfCanvas(canvas, pdfjs);
    }
  }
}

function showError(canvas, message) {
  const figure = canvas.closest("figure");
  const status = figure?.querySelector(".pdf-figure-status");
  if (status) {
    status.textContent = message;
    status.classList.add("pdf-figure-status--error");
  }
}

async function setupPdfCanvas(canvas, pdfjs) {
  const figure = canvas.closest("figure");
  const status = figure.querySelector(".pdf-figure-status");
  const url = canvas.dataset.pdfSrc;
  let documentRef;
  let page;
  try {
    documentRef = await pdfjs.getDocument({url}).promise;
    page = await documentRef.getPage(1);
  } catch (error) {
    console.warn("Could not load PDF", url, error);
    showError(canvas, "Unable to render this diagram. Please refresh the page.");
    return;
  }

  const natural = page.getViewport({scale: 1});
  canvas.style.aspectRatio = natural.width + " / " + natural.height;
  let latestWidth = 0;
  let task = null;
  let scheduled = 0;

  async function render() {
    const width = Math.round(canvas.getBoundingClientRect().width);
    if (width < 1 || width === latestWidth) return;
    latestWidth = width;

    if (task) {
      task.cancel();
      try { await task.promise; } catch (_) { /* Expected cancellation. */ }
    }

    const resolution = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({scale: width * resolution / natural.width});
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));

    const context = canvas.getContext("2d", {alpha: false});
    if (!context) {
      showError(canvas, "Canvas rendering is not available.");
      return;
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    try {
      task = page.render({canvasContext: context, viewport, background: "#ffffff"});
      await task.promise;
      status.hidden = true;
    } catch (error) {
      if (error?.name !== "RenderingCancelledException") {
        console.warn("PDF rendering failed", url, error);
        showError(canvas, "PDF preview unavailable. Please refresh or try another browser.");
      }
    } finally {
      task = null;
    }
  }

  function schedule() {
    cancelAnimationFrame(scheduled);
    scheduled = requestAnimationFrame(render);
  }

  const observer = new ResizeObserver(schedule);
  observer.observe(canvas.parentElement);
  schedule();
}
