import { readFile, unlink, writeFile } from 'node:fs/promises';
import { Graphviz } from '@hpcc-js/wasm-graphviz';

const docs = new URL('../docs/1.3/', import.meta.url);
const sourcePath = new URL('database-overview.dot', docs);
const source = await readFile(sourcePath, 'utf8');
const graphviz = await Graphviz.load();

const labels = {
  users: '用户', sessions: '登录会话', articles: '文章', tags: '标签',
  article_tags: '文章标签', article_review_logs: '文章审核记录',
  comments: '文章评论', comment_likes: '评论点赞', comment_moderation_logs: '评论管理记录',
  article_likes: '文章点赞', article_bookmarks: '文章收藏', bookmark_collections: '收藏夹',
  user_follows: '用户关注', activities: '活动', article_view_windows: '文章阅读去重窗口',
  pulses: '沸点', pulse_view_windows: '沸点阅读去重窗口', pulse_comments: '沸点评论',
  pulse_comment_likes: '沸点评论点赞', pulse_reviews: '沸点审核记录',
  pulse_comment_reviews: '沸点评论审核记录', pulse_tags: '沸点标签', pulse_likes: '沸点点赞',
  checkins: '签到', course_categories: '课程分类', courses: '课程',
  course_lessons: '课程章节', course_lesson_comments: '课程章节评论', notifications: '站内通知',
};

const views = {
  'database-overview.svg': [
    'users', 'articles', 'tags', 'article_tags', 'comments', 'article_bookmarks',
    'bookmark_collections', 'user_follows', 'activities', 'pulses', 'pulse_comments',
    'pulse_tags', 'course_categories', 'courses', 'course_lessons', 'course_lesson_comments', 'notifications',
  ],
  'modules/accounts.svg': ['users', 'sessions'],
  'modules/profiles.svg': ['users', 'user_follows', 'articles', 'pulses', 'courses', 'article_likes', 'article_bookmarks', 'bookmark_collections', 'pulse_likes'],
  'modules/articles.svg': ['users', 'articles', 'tags', 'article_tags', 'article_view_windows'],
  'modules/comments.svg': ['users', 'articles', 'comments', 'comment_likes', 'pulses', 'pulse_comments', 'pulse_comment_likes', 'course_lessons', 'course_lesson_comments'],
  'modules/pulses.svg': ['users', 'pulses', 'tags', 'pulse_tags', 'pulse_likes', 'pulse_comments', 'pulse_view_windows'],
  'modules/courses.svg': ['users', 'course_categories', 'courses', 'course_lessons', 'course_lesson_comments'],
  'modules/creator.svg': ['users', 'articles', 'article_review_logs', 'tags', 'article_tags', 'pulses'],
  'modules/interactions.svg': ['users', 'articles', 'article_likes', 'article_bookmarks', 'bookmark_collections', 'user_follows', 'checkins'],
  'modules/activities.svg': ['users', 'activities'],
  'modules/notifications.svg': ['users', 'notifications'],
  'modules/administration.svg': ['users', 'articles', 'article_review_logs', 'comments', 'comment_moderation_logs', 'pulses', 'pulse_reviews', 'pulse_comments', 'pulse_comment_reviews', 'activities'],
};

const nodePattern = /^    "(\w+)" \[label=<\n[\s\S]*?^      <\/TABLE>>\];\n/gm;
const edgePattern = /^    "(\w+)" -> "(\w+)" \[[^\n]+\];\n/gm;
const sourceTables = new Set([...source.matchAll(nodePattern)].map(([, name]) => name));

for (const [file, tables] of Object.entries(views)) {
  const included = new Set(tables);
  for (const table of included) {
    if (!sourceTables.has(table) || !labels[table]) throw new Error(`缺少表或中文名：${table}`);
  }
  const diagram = source
    .replace('bgcolor="transparent"', 'bgcolor="white"')
    .replaceAll('fontname="Helvetica"', 'fontname="Arial, PingFang SC, Microsoft YaHei, sans-serif"')
    .replace(nodePattern, (node, table) => included.has(table)
      ? node.replace('CELLPADDING="6"', 'CELLPADDING="16"').replace(`<B>${table}</B>`, `<B>${labels[table]}</B><BR/><FONT POINT-SIZE="10">${table}</FONT>`)
      : '')
    .replace(edgePattern, (edge, from, to) => included.has(from) && included.has(to) ? edge : '');
  await writeFile(new URL(file, docs), graphviz.layout(diagram, 'svg', 'dot'));
}

await unlink(sourcePath);
