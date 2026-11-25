import { useEffect, useState } from 'react';
import { Input } from 'antd';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../shared/api/api';
import { CommentMessage } from '../../../shared/ui/comments';
import { Pending } from '../../../shared/ui/pending';
import { AppSelect } from '../../../shared/ui/select';
import { errors } from '../../shared/errors';
import { AdminDateRange, adminTime, appendAdminRange, emptyRange } from '../../shared/ui/date-range';
import { AdminPageSwitch as PageSwitch } from '../../shared/ui/page-switch';

type List<T>={items:T[];hasMore:boolean};
type CommentBase={id:string;createdAt:string;body:string;status:'VISIBLE'|'HIDDEN';author:{displayName:string}};
type Comment=CommentBase & {parent:{id:string;status:'VISIBLE'|'HIDDEN'}|null;article:{id:string;title:string}};
type PulseComment=CommentBase & {pulse:{id:string;body:string}};

export function Comments({pulse:legacyPulse=false,articleId}:{pulse?:boolean;articleId?:string}) {
  const [params]=useSearchParams();
  const navigate=useNavigate();
  const pulse=!articleId&&(legacyPulse||params.get('type')==='pulse');
  const scopeId=articleId??params.get(pulse?'pulseId':'articleId')??undefined;
  return <CommentList key={(pulse?'pulse:':'article:')+(scopeId??'')} pulse={pulse} scopeId={scopeId} embedded={!!articleId}
    onTypeChange={type=>navigate(type==='pulse'?'/comments?type=pulse':'/comments')}/>;
}
function CommentList({pulse,scopeId,embedded,onTypeChange}:{pulse:boolean;scopeId?:string;embedded:boolean;onTypeChange:(value:string)=>void}) {
  const [filter,setFilter]=useState('');
  const [page,setPage]=useState(1);
  const [range,setRange]=useState(emptyRange);
  const [keyword,setKeyword]=useState('');
  const [lookup,setLookup]=useState('');
  const [selection,setSelection]=useState<{value:string;label:string}|undefined>(
    !embedded&&scopeId?{value:'source:'+scopeId,label:pulse?'当前沸点':'当前文章'}:undefined,
  );
  const path=pulse?'/api/admin/pulse-comments':'/api/admin/comments';
  const scope=pulse?'沸点':'文章';
  const fixedScope=embedded;
  const word=keyword.trim();
  useEffect(()=>{
    const timer=window.setTimeout(()=>setLookup(word),200);
    return ()=>window.clearTimeout(timer);
  },[word]);
  const sources=useQuery({
    queryKey:['admin-comment-sources',path,lookup],enabled:!fixedScope,
    queryFn:({signal})=>api<{id:string;label:string}[]>(path+'/sources?'+new URLSearchParams({q:lookup}),'GET',undefined,signal),
  });
  const sourceId=selection?.value.startsWith('source:') ? selection.value.slice(7) : undefined;
  const search=selection?.value.startsWith('keyword:') ? selection.value.slice(8) : undefined;
  const options=[
    ...(!fixedScope?[{value:'all',label:'全部'+scope}]:[]),
    ...(!fixedScope && lookup===word ? sources.data??[] : []).map(item=>({value:'source:'+item.id,label:item.label})),
    ...(word ? [{value:'keyword:'+word,label:'搜索评论：'+word}] : []),
  ];
  if(selection && !options.some(item=>item.value===selection.value)) options.push(selection);
  const selectedArticleId=embedded?scopeId:!pulse?sourceId:undefined;
  const selectedPulseId=pulse?sourceId:undefined;
  const params=appendAdminRange(new URLSearchParams({page:String(page)}),range);
  if(filter) params.set('status',filter);
  if(selectedArticleId) params.set('articleId',selectedArticleId);
  if(selectedPulseId) params.set('pulseId',selectedPulseId);
  if(search) params.set('q',search);
  const query=useQuery({queryKey:['admin-comments',pulse,selectedArticleId,selectedPulseId,filter,search,page,range],queryFn:({signal})=>api<List<Comment|PulseComment>>(path+'?'+params,'GET',undefined,signal)});
  return <>{!embedded&&<h1>评论管理</h1>}
    <div className="admin-comment-filters">
      {!embedded&&<div className="admin-filter"><span>内容类型</span><AppSelect label="内容类型" value={pulse?'pulse':'article'}
        options={[{value:'article',label:'文章'},{value:'pulse',label:'沸点'}]} onChange={onTypeChange}/></div>}
      <div className="admin-comment-search">
        <AppSelect label={fixedScope?'搜索评论':scope+'来源'} value={selection?.value??(!fixedScope?'all':undefined)} options={options}
          placeholder={fixedScope?'输入评论关键词':pulse?'搜索沸点正文、ID 或评论关键词':'搜索文章标题、ID 或评论关键词'}
          search={{value:keyword,onChange:value=>setKeyword(value.slice(0,100)),
            loading:!fixedScope && (lookup!==word || sources.isFetching),
            emptyText:fixedScope?'输入关键词搜索评论':sources.isError?'无法加载候选内容':'暂无候选内容'}}
          onChange={value=>{setSelection(options.find(item=>item.value===value));setKeyword('');setPage(1);}}/>
        {((selection&&selection.value!=='all')||keyword) && <button className="subtle" type="button" onClick={()=>{setKeyword('');setSelection(undefined);setPage(1);}}>清除搜索</button>}
      </div>
      <div className="admin-filter"><span>状态</span><AppSelect label="状态" value={filter} onChange={value=>{setFilter(value);setPage(1);}} options={[{ value: '', label: '全部' }, { value: 'VISIBLE', label: '可见' }, { value: 'HIDDEN', label: '已隐藏' }]}/></div>
    </div>
    <AdminDateRange applied={range} onApply={value=>{setRange(value);setPage(1);}}/>
    {!query.data?<Pending error={query.error} retry={()=>void query.refetch()}/>:<>{query.data.items.length?query.data.items.map(comment=><CommentRow key={comment.id+comment.status} comment={comment} path={path} scoped={fixedScope || !!sourceId} refresh={()=>query.refetch()}/>):<p className="meta">没有匹配的{scope}评论</p>}<PageSwitch page={page} more={query.data.hasMore} update={setPage}/></>}
  </>;
}
function CommentRow({comment,path,scoped,refresh}:{comment:Comment|PulseComment;path:string;scoped:boolean;refresh:()=>Promise<unknown>}) {
  const [reason,setReason]=useState('');
  const [failure,setFailure]=useState('');
  const [busy,setBusy]=useState(false);
  const visible=comment.status==='VISIBLE';
  async function moderate() {
    setBusy(true);setFailure('');
    try{await api(path+'/'+comment.id+'/status','PATCH',{expectedStatus:comment.status,status:visible?'HIDDEN':'VISIBLE',...(visible?{reason}:{})});await refresh();}
    catch(error){setFailure(errors(error));}
    finally{setBusy(false);}
  }
  return <article className="admin-comment">
    <CommentMessage author={comment.author.displayName} body={comment.body} details={<>
      {!scoped && ('article' in comment
        ? <><Link className="meta" to={'/articles/'+comment.article.id}>{comment.article.title||'未命名文章'}</Link>
          <Link to={'/comments?articleId='+comment.article.id}>查看该文章评论</Link></>
        : <><span className="meta">沸点 · {comment.pulse.body.slice(0,80)||'图片沸点'}</span>
          <Link to={'/comments/pulses?pulseId='+comment.pulse.id}>查看该沸点评论</Link></>)}
      <span className="meta">{comment.createdAt?adminTime(comment.createdAt)+' · ':''}{visible?'可见':'已隐藏'}{'parent' in comment && comment.parent &&
        (comment.parent.status === 'HIDDEN' ? ' · 回复 · 所属评论已隐藏' : ' · 回复')}</span>
    </>}/>
    {visible&&<label>隐藏原因<Input.TextArea rows={2} value={reason} disabled={busy} maxLength={1000} onChange={event=>setReason(event.target.value)}/></label>}
    <button className="subtle" disabled={busy||(visible&&!reason.trim())} onClick={moderate}>{visible?'隐藏评论':'恢复评论'}</button>
    {failure&&<p className="error" role="alert">{failure} <button className="subtle" onClick={()=>void refresh()}>刷新</button></p>}
  </article>;
}
