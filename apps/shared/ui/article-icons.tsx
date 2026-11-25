const paths = {
  like: 'M7 10v11H3V10h4Zm0 0 5-8a3 3 0 0 1 3 3v4h4a2 2 0 0 1 2 2.4l-1.4 8a2 2 0 0 1-2 1.6H7',
  comment: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.5-4A8.5 8.5 0 1 1 21 11.5Z',
  bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  share: 'M12 15V3m-4 4 4-4 4 4m3 5v8H5v-8',
  view: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm13 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z',
  check: 'm5 12 4 4L19 6',
};

export function ArticleIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[name]}/>
  </svg>;
}
