import { useEffect, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Node = { type: string; value?: string; children?: Node[]; data?: { hProperties?: Record<string, string> } };
function textOf(node: Node):string { return node.value ?? (node.children ?? []).map(textOf).join(''); }
function headingIds() {
  return (tree:Node) => {
    const used = new Set<string>();
    const walk = (node:Node) => {
      if (node.type==='heading') {
        const base = 'section-' + (textOf(node).normalize('NFKC').toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu,'-').replace(/^-+|-+$/g,'') || 'heading');
        let id=base, suffix=2;
        while(used.has(id)) id=base+'-'+suffix++;
        used.add(id);
        node.data={...node.data,hProperties:{...node.data?.hProperties,id}};
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
function safeUrl(url:string) {
  const allowed=defaultUrlTransform(url);
  return /^(?:https?:|mailto:|\/|#)/i.test(allowed) && !allowed.startsWith('//') ? allowed : '';
}
export function Markdown({ source }: {source:string}) {
  return <div className="markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm,headingIds]} urlTransform={safeUrl}>{source}</ReactMarkdown></div>;
}
export function MarkdownWithToc({source, after, aside}: {source:string;after?:React.ReactNode;aside?:React.ReactNode}) {
  const ref=useRef<HTMLDivElement>(null);
  const [headings,setHeadings]=useState<{id:string;text:string;level:number}[]>([]);
  useEffect(()=>{
    const nodes=ref.current?.querySelectorAll('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]') ?? [];
    setHeadings(Array.from(nodes,node=>({id:node.id,text:node.textContent||'',level:Number(node.tagName.slice(1))})));
  },[source]);
  const toc = headings.length ? <ul className="toc-list">{headings.map(h=><li key={h.id} style={{paddingInlineStart:Math.min(h.level-1,4)*8}}><a href={'#'+h.id}>{h.text}</a></li>)}</ul> : <p className="meta">暂无目录</p>;
  return <>
    <details className="mobile-toc"><summary>文章目录</summary>{toc}</details>
    <div ref={ref}><Markdown source={source}/>{after}</div>
    <aside className="article-aside">{aside}<section className="surface side desktop-toc"><h2>文章目录</h2>{toc}</section></aside>
  </>;
}
