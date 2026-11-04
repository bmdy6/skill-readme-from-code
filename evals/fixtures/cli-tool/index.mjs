import fs from 'node:fs/promises';
const source=process.argv[2]||new URL('./notes.json',import.meta.url);
const notes=JSON.parse(await fs.readFile(source,'utf8'));
const groups={};
for(const note of notes)(groups[note.topic]??=[]).push(note.text);
const digest=Object.entries(groups).map(([topic,items])=>`## ${topic}\n\n${items.map(text=>`- ${text}`).join('\n')}`).join('\n\n');
await fs.writeFile('digest.md',digest+'\n');
console.log('digest.md written');
for(const [topic,items]of Object.entries(groups))console.log(`${topic}: ${items.join('; ')}`);
