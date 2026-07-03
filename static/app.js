// Improved client-side logic with better error handling and file viewer UI
const form = document.getElementById('repo-form');
const repoUrlInput = document.getElementById('repo-url');
const tokenInput = document.getElementById('token');
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

let owner = null, repo = null, currentPath = '';

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = repoUrlInput.value.trim();
  const parsed = parseGitHubUrl(url);
  if (!parsed) return showStatus('Please enter a valid GitHub repository URL', true);
  owner = parsed.owner; repo = parsed.repo; currentPath = '';
  await loadPath('');
});

closeFileBtn.addEventListener('click', () => {
  filePanel.classList.add('hidden');
});

function parseGitHubUrl(url){
  try{
    const u = new URL(url);
    if (!u.hostname.endsWith('github.com')) return null;
    const parts = u.pathname.replace(/^\/+|\/+$/g,'').split('/');
    if (parts.length < 2) return null;
    return {owner:parts[0], repo:parts[1]};
  }catch(e){return null}
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

async function loadPath(path){
  currentPath = path || '';
  breadcrumbEl.innerHTML = renderBreadcrumb(owner, repo, currentPath);
  const apiPath = currentPath ? `/contents/${encodeURIComponent(currentPath)}` : '/contents';
  const url = `https://api.github.com/repos/${owner}/${repo}${apiPath}`;
  listingEl.innerHTML = '<div class="details">Loading...</div>';
  setLoading(true);
  hideStatus();
  try{
    const res = await fetch(url, {headers: apiHeaders()});
    if (res.status === 404) return listingEl.innerHTML = '<div class="details">Not found or access denied (private repo?)</div>';
    if (res.status === 401 || res.status === 403) return listingEl.innerHTML = '<div class="details">Unauthorized or rate-limited. Try a personal access token.</div>';
    const data = await res.json();
    // If the API returns a file object (object with type:file) when the path is a file, open it directly
    if (data && !Array.isArray(data) && data.type === 'file'){
      renderListing([]); // clear listing
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
  // Sort: directories first, then files
  items.sort((a,b)=>{
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'dir' ? -1 : 1;
  });
  listingEl.innerHTML = '';
  if (items.length === 0) listingEl.innerHTML = '<div class="details">(empty)</div>';
  items.forEach(it =>{
    const row = document.createElement('div');
    row.className = 'row';
    const icon = document.createElement('div'); icon.className='icon';
    icon.textContent = it.type === 'dir' ? '📁' : '📄';
    const name = document.createElement('div'); name.className='name';
    name.textContent = it.name;
    const details = document.createElement('div'); details.className='details';
    details.textContent = it.type === 'dir' ? 'Directory' : `${it.size} bytes`;
    row.appendChild(icon); row.appendChild(name); row.appendChild(details);
    row.addEventListener('click', ()=>{
      if (it.type === 'dir'){
        loadPath(currentPath ? `${currentPath}/${it.name}` : it.name);
      }else{
        openFile(it.path);
      }
    });
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
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
      const res = await fetch(url, {headers: apiHeaders()});
      if (!res.ok) return fileContentEl.textContent = `Error: ${res.status} ${res.statusText}`;
      data = await res.json();
    }
    if (data.download_url) fileDownload.href = data.download_url;
    if (data.size) fileMetaEl.textContent = `${data.size} bytes`;

    // If file is large, offer download rather than rendering inline
    const LARGE_THRESHOLD = 200 * 1024; // 200 KB
    if (data.size && data.size > LARGE_THRESHOLD){
      fileContentEl.textContent = `File is large (${data.size} bytes). Use Download to get the file.`;
      return;
    }

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
  }catch(err){
    fileContentEl.textContent = `Error: ${err.message}`;
  }
}

function renderFileContent(text, path){
  // Try to syntax highlight using highlight.js auto-detection
  try{
    const ext = path.split('.').pop().toLowerCase();
    // simple heuristics: if file seems binary (null bytes), don't render
    if (/\x00/.test(text)){
      fileContentEl.textContent = 'Binary file — download instead.';
      return;
    }
    // Use highlight.js
    const highlighted = hljs.highlightAuto(text).value;
    fileContentEl.innerHTML = '<code class="hljs">'+highlighted+'</code>';
  }catch(e){
    fileContentEl.textContent = text;
  }
}

function setLoading(isLoading){
  loadBtn.disabled = isLoading;
  if (isLoading) loadBtn.textContent = 'Loading...'; else loadBtn.textContent = 'Load';
}

// Support direct URL fragment like #owner/repo/path
window.addEventListener('load', ()=>{
  const frag = location.hash.replace(/^#/,'');
  if (!frag) return;
  const parts = frag.split('/');
  if (parts.length >= 2){
    owner = parts[0]; repo = parts[1];
    const path = parts.slice(2).join('/');
    repoUrlInput.value = `https://github.com/${owner}/${repo}`;
    loadPath(path);
  }
});
