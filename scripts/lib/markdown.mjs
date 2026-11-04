import {marked} from 'marked';
import GithubSlugger from 'github-slugger';
export function shellBlocks(md){return marked.lexer(md).filter(t=>t.type==='code'&&(!t.lang||/^(sh|bash|shell|console|zsh)$/.test(t.lang))).map((t,index)=>({index,code:t.text,language:t.lang||'sh'}));}
export function headings(md){const slugger=new GithubSlugger();return marked.lexer(md).filter(t=>t.type==='heading').map(t=>({depth:t.depth,text:t.text,slug:slugger.slug(t.text.replace(/<[^>]*>|[\*_`]/g,''))}));}
export function images(md){const out=[];for(const m of md.matchAll(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)|<img\b([^>]+)>|<source\b([^>]+)>/gi)){
 if(m[2])out.push({src:m[2],alt:m[1],width:null,source:false});else{const attrs=m[3]||m[4],get=k=>attrs.match(new RegExp(`\\b${k}\\s*=\\s*["']([^"']*)["']`,'i'))?.[1];out.push({src:get('src')||get('srcset'),alt:get('alt'),width:get('width'),source:!!m[4]});}
 }return out;}
export function links(md){const out=images(md).map(i=>i.src).filter(Boolean);for(const m of md.matchAll(/(?<!!)\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)|\b(?:href|src)=["']([^"']+)["']/gi))out.push(m[1]||m[2]);return [...new Set(out)];}
export const prose=md=>md.replace(/^```[^\n]*\n[\s\S]*?^```|^~~~[^\n]*\n[\s\S]*?^~~~/gm,'').replace(/^.*\|.*$/gm,'').replace(/<picture>[\s\S]*?<\/picture>/gi,'').replace(/!\[[^\]]*\]\([^)]*\)|<[^>]*>|https?:\/\/\S+/g,'');
