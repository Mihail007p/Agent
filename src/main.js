import { Capacitor } from '@capacitor/core';
import { extractPlan, fileContext, isFileReady, readyFiles, unwrapGeneratedFile } from './project.js';
import { exportProject } from './export-project.js';
import { discoverCloudflareModels, testCloudflareModel } from './cloudflare-models.js';
import { listRepositories, listContents, decodeGithubFile } from './github.js';
import { MAX_ATTACHMENTS, readAttachment, messageParts } from './attachments.js';
import './style.css';

const PROVIDERS = [
  { id:'cloudflare-workers', name:'Cloudflare Workers AI', mode:'cloudflare', endpoint:'', models:['@cf/meta/llama-3.3-70b-instruct-fp8-fast','@cf/meta/llama-3.2-11b-vision-instruct'] },
  { id:'openai', name:'OpenAI', mode:'openai', endpoint:'https://api.openai.com/v1', models:['gpt-4o-mini','gpt-4o','o3-mini'] },
  { id:'anthropic', name:'Anthropic', mode:'anthropic', endpoint:'https://api.anthropic.com', models:['claude-3-5-haiku-latest','claude-3-7-sonnet-latest','claude-sonnet-4-20250514'] },
  { id:'gemini', name:'Google Gemini', mode:'gemini', endpoint:'https://generativelanguage.googleapis.com/v1beta', models:['gemini-2.0-flash','gemini-2.5-flash','gemini-2.5-pro'] },
  { id:'openrouter', name:'OpenRouter', mode:'openai', endpoint:'https://openrouter.ai/api/v1', models:['openai/gpt-4o-mini','anthropic/claude-3.5-haiku','google/gemini-2.0-flash-001'] },
  { id:'groq', name:'Groq', mode:'openai', endpoint:'https://api.groq.com/openai/v1', models:['llama-3.3-70b-versatile','qwen-qwq-32b','deepseek-r1-distill-llama-70b'] },
  { id:'deepseek', name:'DeepSeek', mode:'openai', endpoint:'https://api.deepseek.com/v1', models:['deepseek-chat','deepseek-reasoner'] },
  { id:'mistral', name:'Mistral AI', mode:'openai', endpoint:'https://api.mistral.ai/v1', models:['mistral-small-latest','mistral-large-latest','codestral-latest'] },
  { id:'xai', name:'xAI', mode:'openai', endpoint:'https://api.x.ai/v1', models:['grok-3-mini','grok-3','grok-2-latest'] },
  { id:'together', name:'Together AI', mode:'openai', endpoint:'https://api.together.xyz/v1', models:['meta-llama/Llama-3.3-70B-Instruct-Turbo','Qwen/Qwen2.5-72B-Instruct-Turbo'] },
  { id:'fireworks', name:'Fireworks AI', mode:'openai', endpoint:'https://api.fireworks.ai/inference/v1', models:['accounts/fireworks/models/llama-v3p3-70b-instruct'] },
  { id:'perplexity', name:'Perplexity', mode:'openai', endpoint:'https://api.perplexity.ai', models:['sonar','sonar-pro'] },
  { id:'cerebras', name:'Cerebras', mode:'openai', endpoint:'https://api.cerebras.ai/v1', models:['llama-3.3-70b','qwen-3-32b'] },
  { id:'compatible', name:'OpenAI-compatible', mode:'openai', endpoint:'', models:[] }
];
const $ = id => document.getElementById(id);
const safeRead = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const storedSettings = safeRead('agent.settings', {});
let settings = storedSettings && typeof storedSettings==='object' && !Array.isArray(storedSettings) ? storedSettings : {};
settings.provider=typeof settings.provider==='string'?settings.provider:'';
settings.systemPrompt=typeof settings.systemPrompt==='string'?settings.systemPrompt:'Ты — полезный, точный и дружелюбный AI-ассистент. Отвечай на языке пользователя.';
let chats = safeRead('agent.chats', []);
let activeChatId = null;
let busy = false;
let toastTimer;
let pendingAttachments = [];
let cloudflareModels = [];
let cloudflareRequest = 0;
let cloudflareTimer;

function currentProvider(){return PROVIDERS.find(p=>p.id===settings.provider)||null}
function currentConfig(){return settings.providers?.[settings.provider]||{apiKey:'',model:currentProvider()?.models[0]||'',endpoint:currentProvider()?.endpoint||''}}
function configured(){const c=currentConfig();return !!(currentProvider()&&c.apiKey&&c.model&&(currentProvider().mode!=='openai'||c.endpoint)&&(currentProvider().mode!=='cloudflare'||c.accountId))}
function showToast(text){const t=$('toast');t.textContent=text;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2600)}
let storageWarningShown=false;
function saveData(){try{localStorage.setItem('agent.settings',JSON.stringify(settings));localStorage.setItem('agent.chats',JSON.stringify(chats));return true}catch{if(!storageWarningShown){storageWarningShown=true;showToast('Не удалось сохранить данные на устройстве. Проверьте разрешения и свободное место.')}return false}}
function newChat(){pendingAttachments=[];renderAttachments();if(activeChatId) saveActive();activeChatId=null;$('messages').innerHTML='';$('welcome').classList.remove('hidden');$('promptInput').value='';$('promptInput').focus();renderHistory();closeSidebar()}
function activeChat(){return chats.find(c=>c.id===activeChatId)}
function saveActive(){const c=activeChat();if(c){c.updated=Date.now();saveData();renderHistory()}}
function escapeHTML(text){return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function renderMarkdown(text){
  let src=escapeHTML(text).replace(/\r/g,'');
  const code=[];src=src.replace(/```([\w+-]*)\n?([\s\S]*?)```/g,(_,lang,body)=>{const i=code.push(`<pre><code>${body.trim()}</code></pre>`)-1;return `@@CODE${i}@@`});
  src=src.replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h1>$1</h1>');
  src=src.replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  src=src.replace(/(?:^|\n)([-*] .+(?:\n[-*] .+)*)/g,part=>`<ul>${part.trim().split('\n').map(l=>`<li>${l.replace(/^[-*] /,'')}</li>`).join('')}</ul>`);
  return src.split(/\n\n+/).map(block=>{if(/^@@CODE\d+@@$/.test(block)||/^<(?:h[1-3]|ul|ol|pre)/.test(block))return block;return block.replace(/\n/g,'<br>')?`<p>${block.replace(/\n/g,'<br>')}</p>`:''}).join('').replace(/@@CODE(\d+)@@/g,(_,i)=>code[+i]);
}
function renderMessage(msg,index){const user=msg.role==='user';const el=document.createElement('div');el.className=`message ${user?'user':'assistant'}`;el.innerHTML=`${user?'':`<div class="message-avatar">A</div>`}<div class="message-body"><div class="message-content">${user?escapeHTML(msg.content).replace(/\n/g,'<br>')+(msg.attachments||[]).map(f=>`<div class="sent-attachment">📎 ${escapeHTML(f.name)}</div>`).join(''):renderMarkdown(msg.content)}</div>${user?'':`<div class="message-actions"><button data-copy="${index}">Копировать</button></div>`}</div>`;return el}
function renderChat(){const c=activeChat();$('messages').innerHTML='';if(!c||!c.messages.length){$('welcome').classList.remove('hidden');return}$('welcome').classList.add('hidden');c.messages.forEach((m,i)=>$('messages').appendChild(renderMessage(m,i)));$('messages').scrollIntoView({block:'end'});}
function renderHistory(){const list=$('historyList');list.innerHTML='';[...chats].sort((a,b)=>b.updated-a.updated).slice(0,30).forEach(c=>{const b=document.createElement('button');b.className='history-entry'+(c.id===activeChatId?' selected':'');b.textContent=c.title||'Новый чат';b.title=c.title||'Новый чат';b.onclick=()=>loadChat(c.id);list.appendChild(b)})}
function loadChat(id){if(activeChatId)saveActive();activeChatId=id;renderChat();renderHistory();closeSidebar()}
function setStatus(){const p=currentProvider(),c=currentConfig(),ready=configured();$('modelLabel').textContent=ready?c.model:(p?'Настройте подключение':'Выберите модель');$('composerModel').textContent=ready?`${p.name} · ${c.model}`:'Выберите провайдера в настройках';$('connectionStatus').textContent=ready?`Подключено · ${p.name}`:'Локальный режим';$('profileProvider').textContent=ready?`${p.name} · ${c.model}`:'Настройте провайдера';document.querySelector('.status-dot').classList.toggle('ready',ready);$('sendButton').disabled=busy||(!$('promptInput').value.trim()&&!pendingAttachments.length)||!ready;const menu=$('modelMenu');menu.innerHTML='';PROVIDERS.filter(x=>x.id!=='compatible').forEach(p=>{const conf=settings.providers?.[p.id],btn=document.createElement('button');btn.className='model-option';btn.innerHTML=`<span class="status-dot ${conf?.apiKey?'ready':''}"></span><span>${escapeHTML(p.name)}<small>${escapeHTML(conf?.model||p.models[0])}</small></span>`;btn.onclick=()=>{if(conf?.apiKey){settings.provider=p.id;saveData();setStatus();$('modelMenu').classList.remove('open')}else openSettings(p.id)};menu.appendChild(btn)});if(p?.mode==='cloudflare'&&ready){(c.discoveredModels||[]).forEach(model=>{const btn=document.createElement('button');btn.className='model-option';btn.textContent=(model===c.model?'✓ ':'')+model;btn.onclick=()=>{if(busy)return;settings.providers[p.id].model=model;saveData();setStatus();$('modelMenu').classList.remove('open')};menu.appendChild(btn)})}const custom=document.createElement('button');custom.className='model-option';custom.innerHTML='<span class="status-dot"></span><span>＋ Настроить провайдера</span>';custom.onclick=()=>openSettings();menu.appendChild(custom)}
function updateProviderForm(){cloudflareRequest++;clearTimeout(cloudflareTimer);const id=$('providerSelect').value,p=PROVIDERS.find(x=>x.id===id),c=settings.providers?.[id]||{};$('endpointGroup').classList.toggle('hidden',p.mode!=='openai');$('accountGroup').classList.toggle('hidden',p.mode!=='cloudflare');$('cloudflareModels').classList.toggle('hidden',p.mode!=='cloudflare');$('accountInput').value=c.accountId||'';$('endpointInput').value=c.endpoint??p.endpoint;$('apiKeyInput').value=c.apiKey||'';$('modelInput').value=c.model||p.models[0]||'';$('modelPresets').innerHTML=p.models.map(m=>`<button class="model-chip" type="button" data-model="${escapeHTML(m)}">${escapeHTML(m)}</button>`).join('');$('systemPromptInput').value=settings.systemPrompt||'';if(p.mode==='cloudflare'){cloudflareModels=Array.isArray(c.discoveredModels)?c.discoveredModels:[];renderCloudflareModels();$('cloudflareStatus').textContent='Каталог показывает доступные модели, но их запуск не гарантирован. Проверка делает короткий платный запрос.';scheduleCloudflareDiscovery(true)}}
function openSettings(providerId){const select=$('providerSelect');select.innerHTML=PROVIDERS.map(p=>`<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('');select.value=providerId||settings.provider||'openai';updateProviderForm();$('settingsDialog').showModal()}
function closeSidebar(){$('sidebar').classList.remove('open');$('scrim').classList.remove('show')}
function addMessage(role,content,attachments=[]){let c=activeChat();if(!c){c={id:crypto.randomUUID(),title:role==='user'?content.slice(0,44):'Новый чат',messages:[],updated:Date.now()};chats.push(c);activeChatId=c.id}c.messages.push({role,content,...(attachments.length?{attachments}: {})});c.updated=Date.now();if(role==='user'&&c.messages.filter(m=>m.role==='user').length===1)c.title=content.replace(/\s+/g,' ').slice(0,44);saveData();renderHistory();renderChat()}
function endpointForOpenAI(base){const clean=base.replace(/\/+$/,'');return clean.endsWith('/chat/completions')?clean:`${clean}/chat/completions`}
async function requestAssistant(messages, systemOverride, signal, maxOutputTokens=4096){const p=currentProvider(),c=currentConfig(),system=systemOverride||settings.systemPrompt||'Ты — полезный AI-ассистент.';let url,headers,body;
  if(p.mode==='anthropic'){url=`${c.endpoint.replace(/\/+$/,'')}/v1/messages`;headers={'content-type':'application/json','x-api-key':c.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'};body={model:c.model,max_tokens:maxOutputTokens,system,messages:messages.filter(x=>x.role!=='system').map(x=>({role:x.role,content:messageParts(x,'anthropic')}))}}
  else if(p.mode==='gemini'){url=`${c.endpoint.replace(/\/+$/,'')}/models/${encodeURIComponent(c.model)}:generateContent?key=${encodeURIComponent(c.apiKey)}`;headers={'content-type':'application/json'};body={systemInstruction:{parts:[{text:system}]},contents:messages.filter(x=>x.role!=='system').map(x=>({role:x.role==='assistant'?'model':'user',parts:messageParts(x,'gemini')})),generationConfig:{maxOutputTokens}}
  } else {url=p.mode==='cloudflare'?`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(c.accountId)}/ai/v1/chat/completions`:endpointForOpenAI(c.endpoint);headers={'content-type':'application/json',authorization:`Bearer ${c.apiKey}`};body={model:c.model,messages:[{role:'system',content:system},...messages.filter(x=>x.role!=='system').map(x=>({role:x.role,content:messageParts(x,p.mode)}))],max_tokens:maxOutputTokens,stream:false}}
  let response;try{response=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal})}catch(e){throw new Error(`Не удалось подключиться. Проверьте интернет, URL и ограничения CORS провайдера. ${e.message}`)}
  const data=await response.json().catch(()=>({}));if(!response.ok){const detail=data?.error?.message||data?.message||data?.error?.type||`HTTP ${response.status}`;throw new Error(detail)}
  const text=p.mode==='anthropic'?data.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n'):p.mode==='gemini'?data.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join(''):data.choices?.[0]?.message?.content;
  if(!text)throw new Error(data.promptFeedback?.blockReason?`Ответ заблокирован: ${data.promptFeedback.blockReason}`:'Провайдер вернул пустой ответ или несовместимый формат.');return text;
}
async function sendMessage(text){if((!text.trim()&&!pendingAttachments.length)||busy)return;if(!configured()){openSettings();showToast('Сначала подключите API-провайдера');return}const userText=text.trim()||'Проанализируй вложения.';const attachments=pendingAttachments;pendingAttachments=[];renderAttachments();$('promptInput').value='';resizeInput();addMessage('user',userText,attachments);busy=true;setStatus();const loader=document.createElement('div');loader.className='message assistant';loader.id='typing';loader.innerHTML='<div class="message-avatar">A</div><div class="message-body"><div class="typing-dots"><i></i><i></i><i></i></div></div>';$('messages').appendChild(loader);$('conversation').scrollTop=$('conversation').scrollHeight;try{const answer=await requestAssistant(activeChat().messages);loader.remove();addMessage('assistant',answer)}catch(err){loader.remove();const errEl=document.createElement('div');errEl.className='message assistant';errEl.innerHTML=`<div class="message-avatar">!</div><div class="message-body"><div class="error-box"><b>Не удалось получить ответ</b><br>${escapeHTML(err.message)}<br><br>Проверьте ключ, модель и URL в настройках. Некоторые провайдеры блокируют запросы из браузера; для них нужен серверный прокси.</div></div>`;$('messages').appendChild(errEl);$('conversation').scrollTop=$('conversation').scrollHeight}finally{busy=false;setStatus();$('promptInput').focus()}}
let projectCancelled=false;
let projectController=null;
let generatedProjectFiles=[];
let currentProjectName='agent-project';
let projectPlanTotal=0;
let projectError='';
function projectUI(status,done,total){$('projectStatus').textContent=status;$('projectCount').textContent=total?`${done} / ${total}`:'';$('projectProgressBar').style.width=total?`${Math.min(100,done/total*100)}%`:'0%'}
function showProjectFiles(){const list=$('projectFileList');list.innerHTML='';generatedProjectFiles.forEach(file=>{const row=document.createElement('div');row.className='project-file-row'+(isFileReady(file)?'':' error');row.innerHTML=`<span>${isFileReady(file)?'✓':'⚠'} ${escapeHTML(file.path)}</span><span>${isFileReady(file)?`${Math.max(1,Math.round(file.content.length/1024))} KB`:'ошибка'}</span>`;list.appendChild(row)})}
function setProjectBusy(value){$('downloadProject').textContent=Capacitor.isNativePlatform()?'Сохранить / отправить ZIP':'Скачать ZIP';$('startProject').disabled=value;$('startProject').classList.toggle('running',value);$('startProject').textContent=value?'Генерирую…':'Сгенерировать проект';$('cancelProject').classList.toggle('hidden',!value);$('downloadProject').classList.toggle('hidden',value||readyFiles(generatedProjectFiles).length===0);$('downloadProject').disabled=readyFiles(generatedProjectFiles).length===0}
function openProjectDialog(){if(!configured()){openSettings();showToast('Подключите API-провайдера для создания проекта');return}$('projectDialog').showModal()}
async function buildProject() {
  const idea = $('projectIdea').value.trim();
  if (!idea) { showToast('Опишите идею проекта'); return; }
  if (!configured()) { openSettings(); return; }
  const controller = new AbortController();
  projectController = controller;
  projectCancelled = false;
  projectError = '';
  projectPlanTotal = 0;
  generatedProjectFiles = [];
  $('projectProgress').classList.remove('hidden');
  $('projectFileList').innerHTML = '';
  setProjectBusy(true);
  projectUI('Составляю план файлов…', 0, 0);
  const maxFiles = Math.max(1, Math.min(30, Number($('maxProjectFiles').value) || 16));
  const planSystem = `Ты — технический архитектор. Из идеи пользователя подготовь реалистичный проект. Верни ТОЛЬКО валидный JSON без markdown: {"projectName":"короткое-имя","files":[{"path":"относительный/путь.ext","description":"что реализовать"}]}. Не более ${maxFiles} файлов. Включи исходники, README с командами запуска и тесты по необходимости. Только текстовые файлы; без секретов и внешних действий. Пути относительные, без ../. Не обещай выполнение или тестирование кода: ты создаёшь исходники.`;
  try {
    const planText = await requestAssistant([{ role: 'user', content: idea }], planSystem, controller.signal);
    if (controller.signal.aborted) return;
    const plan = extractPlan(planText, maxFiles);
    const files = plan.files;
    currentProjectName = plan.projectName;
    projectPlanTotal = files.length;
    projectUI('План готов. Генерирую файлы…', 0, files.length);
    for (let i = 0; i < files.length; i++) {
      if (controller.signal.aborted) break;
      const file = files[i];
      projectUI(`Создаю ${file.path}`, i, files.length);
      const fileSystem = 'Ты — опытный разработчик. Верни только полное содержимое ОДНОГО файла, без markdown-ограждений и пояснений. Не оставляй TODO и нереализованные функции. Используй точные имена и экспорты уже созданных файлов. Выбирай простые решения, соответствующие плану. Не утверждай, что выполнил или протестировал код.';
      const context = fileContext(generatedProjectFiles);
      const prompt = `Идея проекта:\n${idea}\n\nИмя: ${currentProjectName}\n\nПлан:\n${files.map(f => `- ${f.path}: ${f.description}`).join('\n')}\n\nСгенерируй файл: ${file.path}\nТребование: ${file.description}\n${context ? `\nУже созданные файлы (полные тексты; более ранние файлы могут не помещаться в бюджет контекста):\n${context}\n` : ''}\nОтветь только содержимым файла.`;
      try {
        const content = await requestAssistant([{ role: 'user', content: prompt }], fileSystem, controller.signal, 8192);
        if (controller.signal.aborted) break;
        generatedProjectFiles.push({ path: file.path, content: unwrapGeneratedFile(content) });
        showProjectFiles();
        projectUI(`Готово: ${file.path}`, i + 1, files.length);
      } catch (error) {
        if (controller.signal.aborted) break;
        projectError = error.message;
        generatedProjectFiles.push({ path: file.path, content: '', error: true });
        showProjectFiles();
        break;
      }
    }
    const count = readyFiles(generatedProjectFiles).length;
    if (controller.signal.aborted || projectCancelled) {
      projectUI(count ? 'Остановлено. Готовые файлы можно сохранить в ZIP.' : 'Остановлено до создания файлов.', count, files.length);
    } else if (projectError) {
      projectUI(`Ошибка: ${projectError}. Готовые файлы можно сохранить; для остальных запустите генерацию заново.`, count, files.length);
    } else {
      projectUI(`Проект готов.${plan.skipped ? ` Пропущено небезопасных/лишних путей: ${plan.skipped}.` : ''} Код не запускался и не тестировался.`, count, files.length);
    }
  } catch (error) {
    projectUI(controller.signal.aborted ? 'Остановлено' : `Ошибка: ${error.message}`, readyFiles(generatedProjectFiles).length, projectPlanTotal);
  } finally {
    projectController = null;
    setProjectBusy(false);
    showProjectFiles();
  }
}

async function downloadProjectZip() {
  if (!readyFiles(generatedProjectFiles).length) { showToast('Пока нет готовых файлов'); return; }
  $('downloadProject').disabled = true;
  $('downloadProject').textContent = 'Готовлю ZIP…';
  try {
    const result = await exportProject(generatedProjectFiles, currentProjectName);
    showToast(result.native ? `ZIP с ${result.count} файлами передан системному меню` : `Загрузка ZIP началась · файлов: ${result.count}`);
  } catch (error) {
    showToast(`Не удалось сохранить ZIP: ${error.message}`);
  } finally {
    setProjectBusy(false);
  }
}

function resizeInput(){const el=$('promptInput');el.style.height='auto';el.style.height=`${Math.min(el.scrollHeight,160)}px`;setStatus()}
if(!settings.providers||typeof settings.providers!=='object')settings.providers={};
PROVIDERS.forEach(p=>{const saved=settings.providers[p.id];settings.providers[p.id]={apiKey:typeof saved?.apiKey==='string'?saved.apiKey:'',model:typeof saved?.model==='string'?saved.model:(p.models[0]||''),endpoint:typeof saved?.endpoint==='string'?saved.endpoint:p.endpoint,accountId:typeof saved?.accountId==='string'?saved.accountId:'',discoveredModels:Array.isArray(saved?.discoveredModels)?saved.discoveredModels.filter(x=>typeof x==='string').slice(0,2000):[]}});
if(!Array.isArray(chats))chats=[];
chats=chats.filter(c=>c&&typeof c.id==='string'&&Array.isArray(c.messages)&&c.messages.every(m=>m&&typeof m.content==='string'&&['user','assistant'].includes(m.role)));
$('newChat').onclick=newChat;$('openSettings').onclick=()=>openSettings();$('openSettingsSide').onclick=()=>openSettings();$('openSettingsBottom').onclick=()=>openSettings();$('connectCta').onclick=()=>openSettings();$('closeSettings').onclick=()=>$('settingsDialog').close();$('cancelSettings').onclick=()=>$('settingsDialog').close();$('providerSelect').onchange=updateProviderForm;
function renderCloudflareModels(){const select=$('cloudflareModelSelect'),current=$('modelInput').value;select.innerHTML='';const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=cloudflareModels.length?'Выберите модель из каталога':'Модели не загружены';select.appendChild(placeholder);cloudflareModels.forEach(model=>{const option=document.createElement('option');option.value=model;option.textContent=model;select.appendChild(option)});select.value=cloudflareModels.includes(current)?current:''}
function cloudflareFormValid(){return $('providerSelect').value==='cloudflare-workers'&&/^[a-f0-9]{32}$/i.test($('accountInput').value.trim())&&!!$('apiKeyInput').value.trim()}
function scheduleCloudflareDiscovery(preserve=false){cloudflareRequest++;clearTimeout(cloudflareTimer);if(preserve!==true)cloudflareModels=[];renderCloudflareModels();if(cloudflareFormValid())cloudflareTimer=setTimeout(refreshCloudflareModels,800)}
async function refreshCloudflareModels(){clearTimeout(cloudflareTimer);if(!cloudflareFormValid()){$('cloudflareStatus').textContent='Введите Account ID и API Token Cloudflare.';return}const account=$('accountInput').value.trim(),token=$('apiKeyInput').value.trim(),request=++cloudflareRequest;$('cloudflareStatus').textContent='Загружаем каталог Cloudflare…';try{const models=await discoverCloudflareModels(account,token);if(request!==cloudflareRequest)return;cloudflareModels=models;const saved=settings.providers['cloudflare-workers'];if(saved?.accountId===account&&saved?.apiKey===token){saved.discoveredModels=models;saveData();setStatus()}if(!$('settingsDialog').open)return;renderCloudflareModels();$('cloudflareStatus').textContent=models.length?`Найдено ${models.length} моделей. Доступ к каждой модели не гарантирован; выберите и проверьте её.`:'Текстовые модели не найдены. Можно ввести ID вручную.'}catch(e){if(request===cloudflareRequest)$('cloudflareStatus').textContent=e.message}}
$('accountInput').addEventListener('input',scheduleCloudflareDiscovery);$('apiKeyInput').addEventListener('input',()=>{if($('providerSelect').value==='cloudflare-workers')scheduleCloudflareDiscovery()});
$('refreshCloudflare').onclick=refreshCloudflareModels;
$('cloudflareModelSelect').onchange=()=>{if($('cloudflareModelSelect').value)$('modelInput').value=$('cloudflareModelSelect').value};
$('modelInput').addEventListener('input',()=>{if($('providerSelect').value==='cloudflare-workers')renderCloudflareModels()});
$('testCloudflare').onclick=async()=>{if(!cloudflareFormValid()){$('cloudflareStatus').textContent='Введите Account ID и API Token Cloudflare.';return}if(!confirm('Проверка отправит короткий запрос к модели и может расходовать платные ресурсы Cloudflare. Продолжить?'))return;const request=++cloudflareRequest,account=$('accountInput').value.trim(),token=$('apiKeyInput').value.trim(),model=$('modelInput').value.trim();$('cloudflareStatus').textContent='Проверяем модель…';try{await testCloudflareModel(account,token,model);if(request===cloudflareRequest)$('cloudflareStatus').textContent=`Модель ${model} ответила. Можно сохранить настройки.`}catch(e){if(request===cloudflareRequest)$('cloudflareStatus').textContent=`Проверка не удалась: ${e.message}`}};
$('modelPresets').onclick=e=>{const btn=e.target.closest('[data-model]');if(btn){$('modelInput').value=btn.dataset.model;renderCloudflareModels()}};
$('toggleKey').onclick=()=>{const i=$('apiKeyInput');i.type=i.type==='password'?'text':'password';$('toggleKey').textContent=i.type==='password'?'Показать':'Скрыть'};
$('advancedToggle').onchange=e=>$('systemPromptGroup').classList.toggle('hidden',!e.target.checked);
$('saveSettings').onclick=()=>{const id=$('providerSelect').value,p=PROVIDERS.find(x=>x.id===id),apiKey=$('apiKeyInput').value.trim(),model=$('modelInput').value.trim(),endpoint=$('endpointInput').value.trim().replace(/\/+$/,''),accountId=$('accountInput').value.trim();if(p.mode==='cloudflare'&&!/^[a-f0-9]{32}$/i.test(accountId)){showToast('Укажите корректный Cloudflare Account ID (32 символа)');return}if(!model){showToast('Укажите название модели');return}if(!apiKey){showToast('Добавьте API-ключ');return}if(p.mode==='openai'){try{const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password)throw new Error('HTTPS required')}catch{showToast('Укажите корректный адрес API на HTTPS, без логина и пароля в URL');return}}settings.provider=id;settings.providers[id]={apiKey,model,accountId,endpoint:p.mode==='openai'?endpoint:p.endpoint,discoveredModels:p.mode==='cloudflare'?cloudflareModels:[]};settings.systemPrompt=$('systemPromptInput').value.trim()||'Ты — полезный, точный и дружелюбный AI-ассистент. Отвечай на языке пользователя.';const saved=saveData();setStatus();$('settingsDialog').close();if(saved)showToast('Настройки сохранены на устройстве')};

function renderAttachments(){const list=$('attachmentList');list.innerHTML='';pendingAttachments.forEach((file,i)=>{const chip=document.createElement('span');chip.className='attachment-chip';chip.textContent=`📎 ${file.name} `;const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Удалить ${file.name}`);remove.onclick=()=>{pendingAttachments.splice(i,1);renderAttachments();setStatus()};chip.appendChild(remove);list.appendChild(chip)});}
async function addAttachments(files){for(const file of files){if(pendingAttachments.length>=MAX_ATTACHMENTS){showToast(`Максимум ${MAX_ATTACHMENTS} файла`);break}try{pendingAttachments.push(await readAttachment(file))}catch(e){showToast(e.message)}}renderAttachments();setStatus()}
$('attachButton').onclick=()=>$('fileInput').click();
$('fileInput').onchange=e=>{addAttachments([...e.target.files]);e.target.value=''};
$('promptInput').addEventListener('paste',e=>{const files=[...e.clipboardData.files];if(files.length){e.preventDefault();addAttachments(files)}});
$('composer').onsubmit=e=>{e.preventDefault();sendMessage($('promptInput').value)};$('promptInput').addEventListener('input',resizeInput);$('promptInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!$('sendButton').disabled)sendMessage($('promptInput').value)}});
$('modelSelect').onclick=()=>$('modelMenu').classList.toggle('open');document.addEventListener('click',e=>{if(!e.target.closest('.model-select-wrap'))$('modelMenu').classList.remove('open')});
document.querySelectorAll('.suggestion').forEach(b=>b.onclick=()=>{if(!configured()){openSettings();return}$('promptInput').value=b.dataset.prompt;resizeInput();$('promptInput').focus()});
$('messages').addEventListener('click',async e=>{const b=e.target.closest('[data-copy]');if(!b)return;const content=activeChat()?.messages[+b.dataset.copy]?.content;if(content){try{await navigator.clipboard.writeText(content);showToast('Скопировано')}catch{showToast('Не удалось скопировать')}}});
$('clearHistory').onclick=()=>{if(confirm('Удалить все локальные чаты?')){chats=[];activeChatId=null;saveData();renderChat();renderHistory()}};
$('menuToggle').onclick=()=>{$('sidebar').classList.add('open');$('scrim').classList.add('show')};$('closeSidebar').onclick=closeSidebar;$('scrim').onclick=closeSidebar;
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();newChat()}if(e.key==='Escape')closeSidebar()});

let githubToken = '', githubRepo = '', githubPath = '', githubRequest = 0;
$('openGithub').onclick=()=>{closeSidebar();$('githubDialog').showModal()};
$('closeGithub').onclick=()=>$('githubDialog').close();
$('githubDisconnect').onclick=()=>{githubRequest++;githubToken='';githubRepo='';githubPath='';$('githubToken').value='';$('githubBrowser').classList.add('hidden');$('githubRepos').innerHTML='';$('githubFiles').innerHTML='';$('githubStatus').textContent='Отключено';};
$('githubConnect').onclick=async()=>{const token=$('githubToken').value.trim();if(!token){$('githubStatus').textContent='Укажите токен GitHub';return}const request=++githubRequest;$('githubStatus').textContent='Подключение…';$('githubBrowser').classList.add('hidden');try{const repos=await listRepositories(token);if(request!==githubRequest)return;githubToken=token;$('githubToken').value='';const select=$('githubRepos');select.innerHTML='';repos.forEach(repo=>{const option=document.createElement('option');option.value=repo.full_name;option.textContent=repo.full_name;select.appendChild(option)});$('githubStatus').textContent=repos.length?'Показано до 100 недавно обновлённых репозиториев.':'Репозитории не найдены или недоступны.';if(repos.length){$('githubBrowser').classList.remove('hidden');githubRepo=select.value;githubPath='';await showGithubFiles()}}catch(e){if(request===githubRequest)$('githubStatus').textContent=e.message}};
$('githubRepos').onchange=()=>{githubRepo=$('githubRepos').value;githubPath='';showGithubFiles()};
$('githubUp').onclick=()=>{githubPath=githubPath.split('/').slice(0,-1).join('/');showGithubFiles()};
async function showGithubFiles(){const request=++githubRequest,repo=githubRepo,path=githubPath;$('githubFiles').innerHTML='';$('githubPath').textContent=`${repo} / ${path}`;$('githubUp').disabled=!path;$('githubStatus').textContent='Загрузка файлов…';try{const entries=await listContents(githubToken,repo,path);if(request!==githubRequest)return;if(!Array.isArray(entries))throw new Error('Не удалось открыть каталог');$('githubStatus').textContent='Выберите файл, чтобы прикрепить его к сообщению.';entries.filter(x=>x.type==='dir'||x.type==='file').sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):a.type==='dir'?-1:1).forEach(entry=>{const button=document.createElement('button');button.type='button';button.className='github-file';button.textContent=`${entry.type==='dir'?'📁':'📄'} ${entry.name}`;button.onclick=async()=>{if(entry.type==='dir'){githubPath=entry.path;showGithubFiles();return}if(pendingAttachments.length>=MAX_ATTACHMENTS){showToast(`Максимум ${MAX_ATTACHMENTS} файла`);return}const fileRequest=++githubRequest;$('githubStatus').textContent='Чтение файла…';try{const file=await listContents(githubToken,repo,entry.path);if(fileRequest!==githubRequest)return;const text=decodeGithubFile(file);pendingAttachments.push({name:`${repo}/${entry.path}`,type:'text/plain',kind:'text',text});renderAttachments();setStatus();$('githubStatus').textContent='Файл добавлен к сообщению.';showToast('Файл добавлен к сообщению')}catch(e){if(fileRequest===githubRequest)$('githubStatus').textContent=e.message}};$('githubFiles').appendChild(button)})}catch(e){if(request===githubRequest)$('githubStatus').textContent=e.message}}
$('openProjectAgent').onclick=openProjectDialog;$('closeProject').onclick=()=>$('projectDialog').close();$('startProject').onclick=buildProject;$('downloadProject').onclick=downloadProjectZip;$('cancelProject').onclick=()=>{projectCancelled=true;projectController?.abort();projectUI('Останавливаю…',readyFiles(generatedProjectFiles).length,projectPlanTotal)};
renderHistory();setStatus();
