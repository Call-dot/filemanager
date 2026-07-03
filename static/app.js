// Feature upgrades: branch selector, search, embed code generation, improved error handling
const form = document.getElementById('repo-form');
const repoUrlInput = document.getElementById('repo-url');
const tokenInput = document.getElementById('token');
const branchSelect = document.getElementById('branch-select');
const listingEl = document.getElementById('listing');
const breadcrumbEl = document.getElementById('breadcrumb');
const statusEl = document.getElementById('status');
const filePanel = document.getElementById('file-panel');
const fileContentEl = document.getElementById('file-content');
const fileNameEl = document.getElementById('file-name');
const fileMetaEl = document.getElementById('file-meta');
const fileDownload = document.getElementById('file-download');
const closeFileBtn = document.getElementById('close-file');
const loadBtn = document.getElementById('load-btn');
const embedBtn = document.getElementById('embed-btn');
const embedModal = document.getElementById('embed-modal');
const embedCode = document.getElementById('embed-code');
const copyEmbed = document.getElementById('copy-embed');
const closeEmbed = document.getElementById('close-embed');
const searchInput = document.getElementById('search-input');

let owner = null, repo = null, currentPath = '', currentBranch = null;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = repoUrlInput.value.trim();
  const parsed = parseGitHubUrl(url);
  if (!parsed) return showStatus('Please enter a valid GitHub repository URL', true);
  owner = parsed.owner; repo = parsed.repo; currentPath = '';
  currentBranch = null;
  branchSelect.classList.add('hidden');
  await loadBranches();
  await loadPath('');
});

branchSelect.addEventListener('change', ()=>{
  const val = branchSelect.value;
  currentBranch = val === 'default' ? null : val;
  loadPath(currentPath);
});

closeFileBtn.addEventListener('click', () => {
  filePanel.classList.add('hidden');
});

embedBtn.addEventListener('click', ()=>{
  if (!owner || !repo) return showStatus('Load a repository first to generate embed code', true);
  const site = `${location.origin}${location.pathname}`;
  const params = new URLSearchParams();
  params.set('repo', `${owner}/${repo}`);
  if (currentBranch) params.set('branch', currentBranch);
  if (currentPath) params.set('path', currentPath);
  const src = `${site}?${params.toString()}`;
  const iframe = `<iframe src="${src}" width="100%" height="600" frameborder="0"></iframe>`;
  embedCode.value = iframe;
  embedModal.classList.remove('hidden');
});

copyEmbed.addEventListener('click', async ()=>{
  try{ await navigator.clipboard.writeText(embedCode.value); showStatus('Copied embed code to clipboard'); }
  catch(e){ showStatus('Copy failed: '+e.message, true); }
});
closeEmbed.addEventListener('click', ()=> embedModal.classList.add('hidden'));

searchInput.addEventListener('input', ()=>{
  const q = searchInput.value.trim().toLowerCase();
  Array.from(listingEl.querySelectorAll('.row')).forEach(row=>{
    const name = row.querySelector('.name').textContent.toLowerCase();
    row.style.display = name.includes(q) ? '' : 'none';
  });
});

function parseGitHubUrl(url){
  try{
    const u = new URL(url);
    if (!u.hostname.endsWith('github.com')) return null;
    const parts = u.pathname.replace(/^\/+|\/+$/g,'').split('/');
    if (parts.length < 2) return null;
    return {owner:parts[0], repo:parts[1]};
  }catch(e){
    // allow repo=owner/repo query param
    if (url.includes('/')){
      const parts = url.split('/');
      if (parts.length === 2) return {owner:parts[0], repo:parts[1]};
    }
    return null;
  }
}

function apiHeaders(){
  const headers = { 'Accept':'application/vnd.github.v3+json' };
  const token = tokenInput.value.trim();
  if (token) headers['Authorization'] = 'token ' + token;
  return headers;
}

function showStatus(msg, isError=false){
  statusEl.textContent = msg;
  statusEl.classList.toggle('hidden', false);
  statusEl.style.borderColor = isError ? '#f0a' : '';
}

function hideStatus(){ statusEl.classList.add('hidden'); }

async function loadBranches(){
  try{
    showStatus('Loading branches...');
    const url = `https://api.github.com/repos/${owner}/${repo}/branches`;
    const res = await fetch(url, {headers: apiHeaders()});
    if (!res.ok){ hideStatus(); return; }
    const data = await res.json();
    branchSelect.innerHTML = '';
    const defaultOption = document.createElement('option'); defaultOption.value='default'; defaultOption.textContent='Default branch';
    branchSelect.appendChild(defaultOption);
    data.forEach(b=>{ const o = document.createElement('option'); o.value=b.name; o.textContent=b.name; branchSelect.appendChild(o); });
    branchSelect.classList.remove('hidden');
    hideStatus();
  }catch(e){ hideStatus(); }
}

async function loadPath(path){
  currentPath = path || '';
  breadcrumbEl.innerHTML = renderBreadcrumb(owner, repo, currentPath);
  const ref = currentBranch ? `?ref=${encodeURIComponent(currentBranch)}` : '';
  const apiPath = currentPath ? `/contents/${encodeURIComponent(currentPath)}` : '/contents';
  const url = `https://api.github.com/repos/${owner}/${repo}${apiPath}${ref}`;
  listingEl.innerHTML = '<div class="details">Loading...</div>';
  setLoading(true);
  hideStatus();
  try{
    const res = await fetch(url, {headers: apiHeaders()});
    if (res.status === 404) return listingEl.innerHTML = '<div class="details">Not found or access denied (private repo?)</div>';
    if (res.status === 401 || res.status === 403) return listingEl.innerHTML = '<div class="details">Unauthorized or rate-limited. Try a personal access token.</div>';
    const data = await res.json();
    if (data && !Array.isArray(data) && data.type === 'file'){
      renderListing([]);
      await openFile(data.path, data);
      return;
    }
    if (!Array.isArray(data)){
      listingEl.innerHTML = '<div class="details">Unexpected response from API</div>';
      return;
    }
    renderListing(data);
  }catch(err){
    listingEl.innerHTML = `<div class="details">Error: ${err.message}</div>`;
  }finally{ setLoading(false); }
}

function renderBreadcrumb(owner, repo, path){
  const parts = path ? path.split('/') : [];
  const partsHtml = [`<a href="#" data-path="">${repo}</a>`].concat(parts.map((p,i)=>`<a href="#" data-path="${parts.slice(0,i+1).join('/')}">${p}</a>`));
  return `<div class="breadcrumb">`+partsHtml.join(' / ')+`</div>`;
}

breadcrumbEl.addEventListener('click', (e)=>{
  if (e.target.tagName !== 'A') return;
  const p = e.target.getAttribute('data-path');
  loadPath(p);
});

function renderListing(items){
  items.sort((a,b)=>{ if (a.type === b.type) return a.name.localeCompare(b.name); return a.type === 'dir' ? -1 : 1; });
  listingEl.innerHTML = '';
  if (items.length === 0) listingEl.innerHTML = '<div class="details">(empty)</div>';
  items.forEach(it =>{
    const row = document.createElement('div'); row.className = 'row';
    const icon = document.createElement('div'); icon.className='icon'; icon.textContent = it.type === 'dir' ? '📁' : '📄';
    const name = document.createElement('div'); name.className='name'; name.textContent = it.name;
    const details = document.createElement('div'); details.className='details'; details.textContent = it.type === 'dir' ? 'Directory' : `${it.size} bytes`;
    row.appendChild(icon); row.appendChild(name); row.appendChild(details);
    row.addEventListener('click', ()=>{ if (it.type === 'dir'){ loadPath(currentPath ? `${currentPath}/${it.name}` : it.name); }else{ openFile(it.path); } });
    listingEl.appendChild(row);
  });
}

async function openFile(path, preloadedData=null){
  filePanel.classList.remove('hidden');
  fileContentEl.textContent = 'Loading...';
  fileNameEl.textContent = path.split('/').pop();
  fileMetaEl.textContent = '';
  fileDownload.href = '#';
  try{
    let data = preloadedData;
    if (!data){
      const ref = currentBranch ? `?ref=${encodeURIComponent(currentBranch)}` : '';
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${ref}`;
      const res = await fetch(url, {headers: apiHeaders()});
      if (!res.ok) return fileContentEl.textContent = `Error: ${res.status} ${res.statusText}`;
      data = await res.json();
    }
    if (data.download_url) fileDownload.href = data.download_url;
    if (data.size) fileMetaEl.textContent = `${data.size} bytes`;

    const LARGE_THRESHOLD = 200 * 1024; // 200 KB
    if (data.size && data.size > LARGE_THRESHOLD){ fileContentEl.textContent = `File is large (${data.size} bytes). Use Download to get the file.`; return; }

    if (data.encoding === 'base64' && data.content){
      const decoded = atob(data.content.replace(/\n/g,''));
      renderFileContent(decoded, path);
    }else if (data.download_url){
      const raw = await fetch(data.download_url, {headers: apiHeaders()});
      const text = await raw.text();
      renderFileContent(text, path);
    }else{
      fileContentEl.textContent = JSON.stringify(data, null, 2);
    }
  }catch(err){ fileContentEl.textContent = `Error: ${err.message}`; }
}

function renderFileContent(text, path){
  try{
    if (/\x00/.test(text)) { fileContentEl.textContent = 'Binary file — download instead.'; return; }
    const highlighted = hljs.highlightAuto(text).value;
    fileContentEl.innerHTML = '<code class="hljs">'+highlighted+'</code>';
  }catch(e){ fileContentEl.textContent = text; }
}

function setLoading(isLoading){ loadBtn.disabled = isLoading; if (isLoading) loadBtn.textContent = 'Loading...'; else loadBtn.textContent = 'Load'; }

// Support query params: ?repo=owner/repo&branch=name&path=some/dir
window.addEventListener('load', async ()=>{
  const params = new URLSearchParams(location.search);
  const repoParam = params.get('repo');
  const branchParam = params.get('branch');
  const pathParam = params.get('path');
  if (repoParam){
    repoUrlInput.value = `https://github.com/${repoParam}`;
    if (branchParam) currentBranch = branchParam;
    await loadBranches();
    // select branch if provided
    if (branchParam){
      const opt = Array.from(branchSelect.options).find(o=>o.value===branchParam);
      if (opt) branchSelect.value = branchParam;
    }
    await loadPath(pathParam || '');
  } else {
    // support fragment mode as before
    const frag = location.hash.replace(/^#/,'');
    if (!frag) return;
    const parts = frag.split('/');
    if (parts.length >= 2){ owner = parts[0]; repo = parts[1]; const path = parts.slice(2).join('/'); repoUrlInput.value = `https://github.com/${owner}/${repo}`; await loadBranches(); loadPath(path); }
  }
});
