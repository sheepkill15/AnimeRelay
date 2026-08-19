const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'];

export function isYoutubeUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLocaleLowerCase().replace(/\.$/, '');
    return YOUTUBE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}
