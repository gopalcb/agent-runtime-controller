// Escape source first. Never trust document HTML or bypass Angular sanitization.
const escape = (text: string) => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function inline(text: string): string {
  return text.split(/(`[^`]+`)/g).map(part => {
    if (part.startsWith('`')) return `<code>${escape(part.slice(1,-1))}</code>`;
    return escape(part).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|#[\w-]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>');
  }).join('');
}
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r/g,'').split('\n');
  let html = '', code: string[] | null = null, list = '';
  const closeList = () => { if (list) html += `</${list}>`; list = ''; };
  for (let i=0;i<lines.length;i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { closeList(); if (code) {html += `<pre><code>${escape(code.join('\n'))}</code></pre>`;code=null;} else code=[]; continue; }
    if (code) {code.push(line);continue;}
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {closeList();html += `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;continue;}
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i+1] || '')) {
      closeList(); const cells=(row:string)=>row.trim().replace(/^\||\|$/g,'').split('|').map(cell=>inline(cell.trim()));
      html += '<table><thead><tr>'+cells(line).map(c=>`<th>${c}</th>`).join('')+'</tr></thead><tbody>';i++;
      while (i+1<lines.length && lines[i+1].includes('|') && lines[i+1].trim()) html += '<tr>'+cells(lines[++i]).map(c=>`<td>${c}</td>`).join('')+'</tr>';
      html+='</tbody></table>';continue;
    }
    const item = /^\s*([-*]|\d+\.)\s+(.+)$/.exec(line);
    if (item) {const tag=/\d/.test(item[1])?'ol':'ul';if (list!==tag) {closeList();html+=`<${tag}>`;list=tag;}html+=`<li>${inline(item[2]).replace(/^\[x\]/i,'☑').replace(/^\[ \]/,'☐')}</li>`;continue;}
    closeList();
    if (/^>\s?/.test(line)) html+=`<blockquote>${inline(line.replace(/^>\s?/,''))}</blockquote>`;
    else if (/^\s*---+\s*$/.test(line)) html+='<hr>';
    else if (line.trim()) html+=`<p>${inline(line)}</p>`;
  }
  closeList();if(code)html+=`<pre><code>${escape(code.join('\n'))}</code></pre>`;
  return html;
}
