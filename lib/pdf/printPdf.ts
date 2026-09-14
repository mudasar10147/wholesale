/** How long the hidden frame outlives the print call. */
const FRAME_LIFETIME_MS = 60_000;

/**
 * Opens the browser's print dialog for a PDF without leaving the page. The PDF loads in a
 * hidden iframe and that frame is printed, so there is no new tab for a pop-up blocker to
 * stop (the click that asked for it is long gone by the time the PDF is built).
 *
 * The frame is kept for a minute rather than removed straight away: the print preview
 * reads a multi-page document from it, and pulling it early can leave the preview blank.
 * Client-only.
 */
export function printPdfBlob(blob: Blob): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Printing is only available in the browser."));
  }

  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.top = "0";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.border = "0";
  iframe.style.pointerEvents = "none";

  const cleanup = () => {
    URL.revokeObjectURL(url);
    iframe.remove();
  };

  return new Promise<void>((resolve, reject) => {
    iframe.addEventListener(
      "load",
      () => {
        const win = iframe.contentWindow;
        if (!win) {
          cleanup();
          reject(new Error("The print preview could not be opened."));
          return;
        }
        win.focus();
        window.requestAnimationFrame(() => {
          try {
            win.print();
            resolve();
          } catch (err) {
            reject(err instanceof Error ? err : new Error("The print preview could not be opened."));
          } finally {
            window.setTimeout(cleanup, FRAME_LIFETIME_MS);
          }
        });
      },
      { once: true },
    );
    iframe.src = url;
    document.body.appendChild(iframe);
  });
}
