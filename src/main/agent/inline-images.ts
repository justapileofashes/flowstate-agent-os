// Images pasted into the composer travel inside the message text as markdown
// data URLs (`![image](data:image/png;base64,…)`), so they persist and render
// in the chat history. Before a message reaches a model they're pulled out:
// Ollama gets them as real `images` (vision models see them); providers
// without image support get a short note instead of megabytes of base64.

const DATA_IMAGE_RE = /!\[[^\]]*\]\((data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+))\)/gi;

export function hasInlineImages(content: string): boolean {
  DATA_IMAGE_RE.lastIndex = 0;
  return DATA_IMAGE_RE.test(content);
}

/** Split a message into text (images replaced by a marker) and raw base64 images. */
export function extractInlineImages(content: string, marker = '[image attached]'): { text: string; images: string[] } {
  const images: string[] = [];
  const text = content.replace(DATA_IMAGE_RE, (_m, _url: string, b64: string) => {
    images.push(b64);
    return marker;
  });
  return { text, images };
}
