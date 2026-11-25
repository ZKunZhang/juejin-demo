import { Fragment, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from './api';
import type { Article, Tag } from './articles';
import './search.css';

export function Highlight({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword) return text;
  const pattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const parts = [];
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    parts.push(<Fragment key={start}>{text.slice(position, start)}<mark>{match[0]}</mark></Fragment>);
    position = start + match[0].length;
  }
  return <>{parts}{text.slice(position)}</>;
}

export function HeaderSearch({ initial }: { initial: string }) {
  const navigate = useNavigate();
  const [value, setValue] = useState(initial);
  const [focused, setFocused] = useState(false);
  const [debounced, setDebounced] = useState('');
  const keyword = value.trim();
  useEffect(() => {
    if (!focused || !keyword) return;
    const timer = window.setTimeout(() => setDebounced(keyword), 250);
    return () => window.clearTimeout(timer);
  }, [focused, keyword]);
  const { data } = useQuery({
    queryKey: ['article-search-suggestions', debounced],
    enabled: focused && !!debounced && debounced === keyword,
    queryFn: ({ signal }) => api<{ items: Pick<Article, 'id' | 'title'>[] }>(
      '/api/articles?' + new URLSearchParams({ q: debounced, tab: 'recommended', limit: '8' }), 'GET', undefined, signal,
    ),
  });
  const suggestions = focused && keyword && debounced === keyword
    ? data?.items.filter(item => item.title.toLowerCase().includes(keyword.toLowerCase())) ?? [] : [];
  const searchPath = (word: string) => word ? '/?' + new URLSearchParams({ q: word }) : '/';
  return <form className="search header-search" role="search"
    onFocus={() => setFocused(true)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onKeyDown={event => {
      if (event.key === 'Escape' && suggestions.length) {
        event.preventDefault();
        setFocused(false);
      }
    }}
    onSubmit={event => { event.preventDefault(); setFocused(false); navigate(searchPath(keyword)); }}>
    <input aria-label="搜索文章" aria-controls={suggestions.length ? 'search-suggestions' : undefined}
      name="q" type="search" maxLength={100} autoComplete="off" placeholder="搜索技术文章"
      value={value} onChange={event => { setValue(event.target.value); setFocused(true); }}/>
    <button className="search-submit" type="submit" aria-label="搜索">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 4 4" strokeLinecap="round"/></svg>
    </button>
    {suggestions.length > 0 && <ul className="search-suggestions" id="search-suggestions" aria-label="文章搜索建议">
      {suggestions.map(item => <li key={item.id}><Link to={'/articles/' + item.id} onClick={() => setFocused(false)}>
        <Highlight text={item.title} keyword={keyword}/>
      </Link></li>)}
    </ul>}
  </form>;
}

export function SearchArticle({ item, keyword, selectTag }: { item: Article; keyword: string; selectTag: (id: string) => void }) {
  return <article className="search-result">
    <div className="search-result-meta">
      <span>{item.author.displayName}</span>
      {item.publishedAt && <time dateTime={item.publishedAt}>{new Date(item.publishedAt).toLocaleDateString('zh-CN')}</time>}
      {item.tags.map(({ tag }) => <button type="button" key={tag.id} onClick={() => selectTag(tag.id)}>{tag.name}</button>)}
    </div>
    <h2><Link to={'/articles/' + item.id}><Highlight text={item.title} keyword={keyword}/></Link></h2>
    {item.summary && <p className="search-result-summary"><Highlight text={item.summary} keyword={keyword}/></p>}
    {item._count && <p className="search-result-counts">{item.viewCount} 阅读<span>{item._count.likes} 赞</span><span>{item._count.comments} 评论</span></p>}
  </article>;
}

export function MatchingTags({ tags, keyword, selectTag }: { tags: Tag[]; keyword: string; selectTag: (id: string) => void }) {
  const matching = tags.filter(tag => tag.name.toLowerCase().includes(keyword.toLowerCase()) || tag.slug.toLowerCase().includes(keyword.toLowerCase()));
  return matching.length ? <ul className="search-tags">
    {matching.map(tag => <li key={tag.id}><button className="tag" onClick={() => selectTag(tag.id)}>
      <Highlight text={tag.name} keyword={keyword}/>
    </button></li>)}
  </ul> : <p className="work-message">没有匹配的标签</p>;
}
