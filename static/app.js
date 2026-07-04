// Defensive initialization with debug instrumentation
(function(){
  function el(id){
    const e = document.getElementById(id);
    if (!e) console.warn('[filemanager] missing element:', id);
    return e;
  }

  function safe(fn){
    return function(...args){
      try{ return fn.apply(this,args); }
      catch(err){
        console.error('[filemanager] uncaught error in handler:', err);
        const statusEl = el('status');
        if (statusEl){ statusEl.textContent = 'Error: '+err.message; statusEl.classList.remove('hidden'); }
      }
    }
  }

  // Debug instrumentation utilities (visible panel + console logs)
  function createDebugPanel(){
    const panel = document.createElement('div');
    panel.id = 'fm-debug-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: '320px',
      maxHeight: '40vh',
      overflow: 'auto',
      background: 'rgba(0,0,0,0.8)',
      color: '#fff',
      fontSize: '12px',
      padding: '8px',
      borderRadius: '6px',
      zIndex: 99999
    });
    const title = document.createElement('div');
    title.textContent = 'FileManager Debug';
    Object.assign(title.style, {fontWeight:'700', marginBottom:'6px'});
    panel.appendChild(title);
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    Object.assign(clearBtn.style, {float:'right', fontSize:'11px', padding:'2px 6px', marginLeft:'6px'});
    clearBtn.addEventListener('click', ()=>{ body.innerHTML = ''; });
    panel.appendChild(clearBtn);
    const body = document.createElement('div');
    body.id = 'fm-debug-body';
    panel.appendChild(body);
    document.body.appendChild(panel);
    return body;
  }

  function dbg(msg){
    try{ console.debug('[filemanager-debug]', msg); }catch(e){}
    if (!window.__fm_debug_body) return;
    const line = document.createElement('div');
    line.textContent = (new Date()).toISOString() + ' — ' + msg;
    line.style.marginBottom = '4px';
    window.__fm_debug_body.appendChild(line);
  }

  document.addEventListener('DOMContentLoaded', safe(()=>{
    // create debug panel early
    try{ window.__fm_debug_body = createDebugPanel(); dbg('APP INIT'); }catch(e){ console.warn('debug panel failed', e); }

    // DOM elements
    const form = el('repo-form');
    const repoUrlInput = el('repo-url');
    const tokenInput = el('token');
    const branchSelect = el('branch-select');
    const listingEl = el('listing');
    const breadcrumbEl = el('breadcrumb');
    const statusEl = el('status');
    const filePanel = el('file-panel');
    const fileContentEl = el('file-content');
    const fileNameEl = el('file-name');
    const fileMetaEl = el('file-meta');
    const fileDownload = el('file-download');
    const closeFileBtn = el('close-file');
    const loadBtn = el('load-btn');
    const embedBtn = el('embed-btn');
    const embedModal = el('embed-modal');
    const embedCode = el('embed-code');
    const copyEmbed = el('copy-embed');
    const closeEmbed = el('close-embed');
    const searchInput = el('search-input');

    dbg('Elements: ' + JSON.stringify({
      form:!!form, loadBtn:!!loadBtn, embedBtn:!!embedBtn, copyEmbed:!!copyEmbed, closeFileBtn:!!closeFileBtn, searchInput:!!searchInput
    }));

    if (!form || !repoUrlInput || !listingEl || !fileContentEl){
      console.error('[filemanager] critical elements missing, aborting init');
      dbg('critical elements missing, aborting');
      return;
    }

    let owner = null, repo = null, currentPath = '', currentBranch = null;

    form.addEventListener('submit', safe(async (e)=>{
      dbg('submit form');
      e.preventDefault();
      const url = repoUrlInput.value.trim();
      dbg('repo url: '+url);
      const parsed = parseGitHubUrl(url);
      if (!parsed){ dbg('parse failed'); return showStatus('Please enter a valid GitHub repository URL', true); }
      owner = parsed.owner; repo = parsed.repo; currentPath = '';
      currentBranch = null;
      if (branchSelect) branchSelect.classList.add('hidden');
      await loadBranches();
      await loadPath('');
    }));

    if (branchSelect){
      branchSelect.addEventListener('change', safe(()=>{
        dbg('branch change: '+branchSelect.value);
        const val = branchSelect.value;
        currentBranch = val === 'default' ? null : val;
        loadPath(currentPath);
      }));
    }

    if (closeFileBtn) closeFileBtn.addEventListener('click', safe(()=>{ dbg('close-file click'); filePanel && filePanel.classList.add('hidden'); }));

    if (embedBtn){
      embedBtn.addEventListener('click', safe(()=>{
        dbg('embed click');
        if (!owner || !repo) return showStatus('Load a repository first to generate embed code', true);
        const site = `${location.origin}${location.pathname}`;
        const params = new URLSearchParams();
        params.set('repo', `${owner}/${repo}`);
        if (currentBranch) params.set('branch', currentBranch);
        if (currentPath) params.set('path', currentPath);
        const src = `${site}?${params.toString()}`;
        const iframe = `<iframe src="${src}" width="100%" height="600" frameborder="0"></iframe>`;
        if (embedCode) embedCode.value = iframe;
        embedModal && embedModal.classList.remove('hidden');
      }));
    }

    if (copyEmbed) copyEmbed.addEventListener('click', safe(async ()=>{
      dbg('copy-embed click');
      try{ await navigator.clipboard.writeText(embedCode.value); showStatus('Copied embed code to clipboard'); }
      catch(e){ showStatus('Copy failed: '+e.message, true); }
    }));
    if (closeEmbed) closeEmbed.addEventListener('click', safe(()=>{ dbg('close-embed click'); embedModal && embedModal.classList.add('hidden'); }));

    if (searchInput){
      searchInput.addEventListener('input', safe(()=>{
        dbg('search input: '+searchInput.value);
        const q = searchInput.value.trim().toLowerCase();
        Array.from(listingEl.querySelectorAll('.row')).forEach(row=>{
          const name = (row.querySelector('.name') && row.querySelector('.name').textContent || '').toLowerCase();
          row.style.display = name.includes(q) ? '' : 'none';
        });
      }));
    }

    // capture clicks globally too to see if events bubble
    document.addEventListener('click', (ev)=>{
      try{
        const t = ev.target;
        const id = t && t.id ? t.id : null;
        const cls = t && t.className ? (typeof t.className === 'string' ? t.className : '') : '';
        if (id || cls){ dbg('global click target id='+id+' class='+cls+' tag='+t.tagName); }
      }catch(e){}
    }, true);

    function parseGitHubUrl(url){
      try{
        const u = new URL(url);
        if (!u.hostname.endsWith('github.com')) return null;
        const parts = u.pathname.replace(/^\/+|\/+$/g,'').split('/');
        if (parts.length < 2) return null;
        return {owner:parts[0], repo:parts[1]};
      }catch(e){
        if (url.includes('/')){
          const parts = url.split('/');
          if (parts.length === 2) return {owner:parts[0], repo:parts[1]};
        }
        return null;
      }
    }

    function apiHeaders(){
      const headers = { 'Accept':'application/vnd.github.v3+json' };
      const token = tokenInput && tokenInput.value.trim();
      if (token) headers['Authorization'] = 'token ' + token;
      return headers;
    }

    function showStatus(msg, isError=false){
      if (!statusEl) return console.log('[filemanager] status:', msg);
      statusEl.textContent = msg;
      statusEl.classList.toggle('hidden', false);
      statusEl.style.borderColor = isError ? '#f0a' : '';
    }
    function hideStatus(){ statusEl && statusEl.classList.add('hidden'); }

    async function loadBranches(){
      try{
        showStatus('Loading branches...');
        const url = `https://api.github.com/repos/${owner}/${repo}/branches`;
        dbg('fetch branches: '+url);
        const res = await fetch(url, {headers: apiHeaders()});
        dbg('branches response status: '+res.status);
        if (!res.ok){ hideStatus(); return; }
        const data = await res.json();
        if (!branchSelect) return;
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
      if (breadcrumbEl) breadcrumbEl.innerHTML = renderBreadcrumb(owner, repo, currentPath);
      const ref = currentBranch ? `?ref=${encodeURIComponent(currentBranch)}` : '';
      const apiPath = currentPath ? `/contents/${encodeURIComponent(currentPath)}` : '/contents';
      const url = `https://api.github.com/repos/${owner}/${repo}${apiPath}${ref}`;
      if (listingEl) listingEl.innerHTML = '<div class="details">Loading...</div>';
      setLoading(true);
      hideStatus();
      try{
        dbg('fetch contents: '+url);
        const res = await fetch(url, {headers: apiHeaders()});
        dbg('contents response status: '+res.status);
        if (res.status === 404) return listingEl && (listingEl.innerHTML = '<div class="details">Not found or access denied (private repo?)</div>');
        if (res.status === 401 || res.status === 403) return listingEl && (listingEl.innerHTML = '<div class="details">Unauthorized or rate-limited. Try a personal access token.</div>');
        const data = await res.json();
        if (data && !Array.isArray(data) && data.type === 'file'){
          listingEl && (listingEl.innerHTML = '');
          await openFile(data.path, data);
          return;
        }
        if (!Array.isArray(data)){
          listingEl && (listingEl.innerHTML = '<div class="details">Unexpected response from API</div>');
          return;
        }
        renderListing(data);
      }catch(err){ listingEl && (listingEl.innerHTML = `<div class="details">Error: ${err.message}</div>`); }
      finally{ setLoading(false); }
    }

    function renderBreadcrumb(owner, repo, path){
      const parts = path ? path.split('/') : [];
      const partsHtml = [`<a href="#" data-path="">${repo}</a>`].concat(parts.map((p,i)=>`<a href="#" data-path="${parts.slice(0,i+1).join('/')}">${p}</a>`));
      return `<div class="breadcrumb">`+partsHtml.join(' / ')+`</div>`;
    }

    if (breadcrumbEl){
      breadcrumbEl.addEventListener('click', safe((e)=>{
        dbg('breadcrumb click: '+(e.target && e.target.getAttribute && e.target.getAttribute('data-path')));
        if (e.target.tagName !== 'A') return;
        const p = e.target.getAttribute('data-path');
        loadPath(p);
      }));
    }

    function renderListing(items){
      if (!listingEl) return;
      items.sort((a,b)=>{ if (a.type === b.type) return a.name.localeCompare(b.name); return a.type === 'dir' ? -1 : 1; });
      listingEl.innerHTML = '';
      if (items.length === 0) listingEl.innerHTML = '<div class="details">(empty)</div>';
      items.forEach(it =>{
        const row = document.createElement('div'); row.className = 'row';
        const icon = document.createElement('div'); icon.className='icon'; icon.textContent = it.type === 'dir' ? '📁' : '📄';
        const name = document.createElement('div'); name.className='name'; name.textContent = it.name;
        const details = document.createElement('div'); details.className='details'; details.textContent = it.type === 'dir' ? 'Directory' : `${it.size} bytes`;
        row.appendChild(icon); row.appendChild(name); row.appendChild(details);
        row.addEventListener('click', safe(()=>{ dbg('listing row click: '+it.path); if (it.type === 'dir'){ loadPath(currentPath ? `${currentPath}/${it.name}` : it.name); }else{ openFile(it.path); } }));
        listingEl.appendChild(row);
      });
    }

    async function openFile(path, preloadedData=null){
      if (filePanel) filePanel.classList.remove('hidden');
      if (fileContentEl) fileContentEl.textContent = 'Loading...';
      if (fileNameEl) fileNameEl.textContent = path.split('/').pop();
      if (fileMetaEl) fileMetaEl.textContent = '';
      if (fileDownload) fileDownload.href = '#';
      try{
        dbg('openFile: '+path);
        let data = preloadedData;
        if (!data){
          const ref = currentBranch ? `?ref=${encodeURIComponent(currentBranch)}` : '';
          const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${ref}`;
          dbg('fetch file: '+url);
          const res = await fetch(url, {headers: apiHeaders()});
          dbg('file response status: '+res.status);
          if (!res.ok) return fileContentEl && (fileContentEl.textContent = `Error: ${res.status} ${res.statusText}`);
          data = await res.json();
        }
        if (data.download_url && fileDownload) fileDownload.href = data.download_url;
        if (data.size && fileMetaEl) fileMetaEl.textContent = `${data.size} bytes`;

        const LARGE_THRESHOLD = 200 * 1024; // 200 KB
        if (data.size && data.size > LARGE_THRESHOLD){ if (fileContentEl) fileContentEl.textContent = `File is large (${data.size} bytes). Use Download to get the file.`; return; }

        if (data.encoding === 'base64' && data.content){
          const decoded = atob(data.content.replace(/\n/g,''));
          renderFileContent(decoded, path);
        }else if (data.download_url){
          const raw = await fetch(data.download_url, {headers: apiHeaders()});
          const text = await raw.text();
          renderFileContent(text, path);
        }else{
          if (fileContentEl) fileContentEl.textContent = JSON.stringify(data, null, 2);
        }
      }catch(err){ if (fileContentEl) fileContentEl.textContent = `Error: ${err.message}`; }
    }

    function renderFileContent(text, path){
      try{
        if (!fileContentEl) return;
        if (/\x00/.test(text)) { fileContentEl.textContent = 'Binary file — download instead.'; return; }
        const highlighted = (window.hljs && hljs.highlightAuto) ? hljs.highlightAuto(text).value : null;
        if (highlighted) fileContentEl.innerHTML = '<code class="hljs">'+highlighted+'</code>';
        else fileContentEl.textContent = text;
      }catch(e){ if (fileContentEl) fileContentEl.textContent = text; }
    }

    function setLoading(isLoading){ if (loadBtn) { loadBtn.disabled = isLoading; if (isLoading) loadBtn.textContent = 'Loading...'; else loadBtn.textContent = 'Load'; } }

    // Support query params: ?repo=owner/repo&branch=name&path=some/dir
    (async function initFromQuery(){
      try{
        const params = new URLSearchParams(location.search);
        const repoParam = params.get('repo');
        const branchParam = params.get('branch');
        const pathParam = params.get('path');
        if (repoParam){
          repoUrlInput.value = `https://github.com/${repoParam}`;
          if (branchParam) currentBranch = branchParam;
          await loadBranches();
          if (branchParam && branchSelect){
            const opt = Array.from(branchSelect.options).find(o=>o.value===branchParam);
            if (opt) branchSelect.value = branchParam;
          }
          await loadPath(pathParam || '');
        } else {
          const frag = location.hash.replace(/^#/,'');
          if (!frag) return;
          const parts = frag.split('/');
          if (parts.length >= 2){ owner = parts[0]; repo = parts[1]; const path = parts.slice(2).join('/'); repoUrlInput.value = `https://github.com/${owner}/${repo}`; await loadBranches(); loadPath(path); }
        }
      }catch(e){ /* ignore */ }
    })();

    // Global error handler that surfaces unhandled errors in the status area
    window.addEventListener('error', (ev)=>{
      console.error('[filemanager] window error', ev.error || ev.message);
      if (statusEl) { statusEl.textContent = 'Runtime error: '+(ev.error && ev.error.message || ev.message); statusEl.classList.remove('hidden'); }
      dbg('window error: '+(ev.error && ev.error.message || ev.message));
    });

  }));

})();
