import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'video', 'rendered');
const toolRoot = join(root, 'tmp', 'video-tools');
const localFfmpeg = join(toolRoot, 'ffmpeg-9.0.2-essentials_build', 'bin', 'ffmpeg.exe');
const ffmpeg = process.env.FFMPEG_PATH || localFfmpeg;
mkdirSync(out, { recursive: true });

execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'video','render-scenes.ps1'),'-Root',root,'-OutDir',out],{stdio:'inherit'});

execFileSync(ffmpeg,['-y','-i',join(out,'scene-01.png'),'-i',join(out,'cricket-ball.png'),'-filter_complex','[1:v]scale=190:190[ball];[0:v][ball]overlay=x=710:y=610[out]','-map','[out]','-frames:v','1','-q:v','2',join(root,'video','linkedin-cover.jpg')],{stdio:'ignore'});

// Original gentle ambient bed: warm, softly voiced chords and a restrained bell motif.
const duration=42, rate=48000, samples=duration*rate, buf=Buffer.alloc(samples*4);
const chords=[[146.83,174.61,220.00],[130.81,164.81,196.00],[110.00,146.83,174.61],[123.47,155.56,185.00],[146.83,174.61,220.00],[130.81,164.81,196.00]];
const melody=[[587.33,0],[440,1],[523.25,2],[392,3],[440,4],[349.23,5],[392,6],[523.25,7],[493.88,8],[392,9],[440,10],[587.33,11],[523.25,12],[440,13],[392,14],[440,15],[349.23,16],[392,17],[493.88,18],[523.25,19],[440,20],[392,21],[349.23,22],[392,23],[440,24],[523.25,25],[587.33,26],[523.25,27],[440,28],[392,29],[349.23,30],[392,31],[440,32],[523.25,33],[493.88,34],[440,35],[392,36],[349.23,37],[392,38],[440,39],[523.25,40]];
for(let i=0;i<samples;i++){
 const t=i/rate, ci=Math.min(chords.length-1,Math.floor(t/7)), local=t%7, fade=Math.min(1,t/1.5,(duration-t)/2);
 let v=0;
 for(const [j,f] of chords[ci].entries()) v+=(Math.sin(2*Math.PI*f*t)+.24*Math.sin(4*Math.PI*f*t))*([.034,.026,.018][j])*(.65+.35*Math.sin(Math.PI*Math.min(1,local/7)));
 const step=Math.floor(t);const note=melody.find(m=>m[1]===step);
 if(note){const dt=t-step, env=Math.exp(-dt*2.5)*(1-Math.exp(-dt*38));v+=env*(.055*Math.sin(2*Math.PI*note[0]*dt)+.016*Math.sin(4*Math.PI*note[0]*dt));}
 v*=fade;const pan=.68+.16*Math.sin(t*.17);const l=Math.max(-.92,Math.min(.92,v*Math.sqrt(1-pan)));const r=Math.max(-.92,Math.min(.92,v*Math.sqrt(pan)));
 buf.writeInt16LE(Math.round(l*32767),i*4);buf.writeInt16LE(Math.round(r*32767),i*4+2);
}
const wav=Buffer.alloc(44+buf.length);wav.write('RIFF',0);wav.writeUInt32LE(36+buf.length,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(buf.length,40);buf.copy(wav,44);writeFileSync(join(out,'original-score.wav'),wav);

// Gentle per-scene 2.5D push-ins and cross fades keep the dimensional card art in motion.
const args=['-y'];for(let i=0;i<7;i++)args.push('-loop','1','-framerate','30','-t','6','-i',join(out,`scene-${String(i+1).padStart(2,'0')}.png`));
args.push('-i',join(out,'original-score.wav'),'-loop','1','-framerate','30','-i',join(out,'cricket-ball.png'));
const filters=[];
for(let i=0;i<7;i++)filters.push(`[${i}:v]scale=1188:1485,zoompan=z='min(1.10,1+0.0007*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=180:s=1080x1350:fps=30,setsar=1,fade=t=in:st=0:d=0.45,fade=t=out:st=5.55:d=0.45,setpts=PTS-STARTPTS[v${i}]`);
for(let i=0;i<6;i++){const a=i===0?'v0':'x'+(i-1);filters.push(`[${a}][v${i+1}]xfade=transition=fade:duration=0.45:offset=${(5.55+i*5.55).toFixed(2)}[x${i}]`)}
filters.push(`[7:a]afade=t=in:st=0:d=2,afade=t=out:st=39:d=3,volume=0.88[a]`);
filters.push(`[8:v]scale=172:172[ball]`);
filters.push(`[x5][ball]overlay=x='if(lt(t,5.45),120+650*t/5.45,W)':y='if(lt(t,5.45),795-170*sin(PI*t/5.45),-220)':eval=frame:format=auto[outv]`);
args.push('-filter_complex',filters.join(';'),'-map','[outv]','-map','[a]','-t','39.75','-r','30','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart',join(root,'pressure-playbook-linkedin.mp4'));
execFileSync(ffmpeg,args,{stdio:'inherit'});
console.log(`Rendered ${join(root,'pressure-playbook-linkedin.mp4')}`);


