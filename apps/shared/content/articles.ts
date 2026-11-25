export type Tag = {id:string;name:string;slug:string};
export type Article = {
  id:string;title:string;summary:string|null;bodyMarkdown:string;
  author:{id:string;displayName:string;username:string;avatarUrl?:string|null};tags:{tag:Tag}[];publishedAt:string|null;
  status:'DRAFT'|'PUBLISHED'|'UNLISTED';reviewStatus:'NOT_SUBMITTED'|'PENDING'|'APPROVED'|'REJECTED';version:number;
  viewCount:number;
  _count?:{likes:number;comments:number};
  related?:{id:string;title:string}[];reason?:string|null;
};
export const statusText=(row:Pick<Article,'status'|'reviewStatus'>)=>row.status==='PUBLISHED'?'已发布':row.status==='UNLISTED'?'已下架':row.reviewStatus==='PENDING'?'待审核':row.reviewStatus==='REJECTED'?'已驳回':'草稿';
