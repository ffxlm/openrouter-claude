let allModels = [];
let activeModelId = '';
let favorites = [];

document.addEventListener('DOMContentLoaded', () => {
    fetchSettings();
    fetchModels();

    document.getElementById('searchInput').addEventListener('input', filterModels);
    document.getElementById('sortSelect').addEventListener('change', filterModels);
    document.getElementById('filterFreeBtn').addEventListener('click', (e) => {
        e.target.classList.toggle('active');
        filterModels();
    });
    document.getElementById('filterFavBtn').addEventListener('click', (e) => {
        e.currentTarget.classList.toggle('active');
        filterModels();
    });
});

async function fetchSettings() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        
        activeModelId = data.activeModel;
        favorites = data.favorites || [];
        document.getElementById('todaySpend').innerText = `$${data.todaySpend.toFixed(4)}`;
        document.getElementById('dailyBudget').innerText = `$${data.dailyBudget.toFixed(2)}`;
        
        updateActiveModelCard();
    } catch (err) {
        console.error('Failed to fetch settings', err);
    }
}

async function fetchModels() {
    try {
        const res = await fetch('/api/models');
        const data = await res.json();
        allModels = data.data;
        renderModels(allModels);
        updateActiveModelCard();
    } catch (err) {
        console.error('Failed to fetch models', err);
        document.getElementById('modelsGrid').innerHTML = '<p style="color:red">Failed to load models.</p>';
    }
}

function updateActiveModelCard() {
    if (!allModels.length || !activeModelId) return;
    
    const model = allModels.find(m => m.id === activeModelId);
    const card = document.getElementById('activeModelCard');
    
    if (model) {
        card.innerHTML = `
            <div class="model-info">
                <h3>${model.name}</h3>
                <p>${model.id}</p>
            </div>
            <div class="status">
                <span style="color: var(--success); display:flex; align-items:center; gap:0.5rem; font-weight:600;">
                    <div style="width:8px; height:8px; background:var(--success); border-radius:50%; box-shadow: 0 0 10px var(--success)"></div>
                    Active Now
                </span>
            </div>
        `;
    }
}

function renderModels(models) {
    const grid = document.getElementById('modelsGrid');
    grid.innerHTML = '';
    
    models.forEach(model => {
        const pPrompt = parseFloat(model.pricing.prompt) || 0;
        const pComp = parseFloat(model.pricing.completion) || 0;
        const isFree = pPrompt === 0 && pComp === 0;
        const isUnknown = pPrompt < 0 || pComp < 0;
        
        let priceDisplay;
        if (isUnknown) {
            priceDisplay = 'Dynamic / Varies';
        } else if (isFree) {
            priceDisplay = 'FREE';
        } else {
            priceDisplay = `$${(pPrompt * 1000000).toFixed(2)} / 1M`;
        }
        const contextDisplay = `${Math.round(model.context_length / 1000)}k ctx`;
        const isCurrent = model.id === activeModelId;
        const isFav = favorites.includes(model.id);

        const el = document.createElement('div');
        el.className = 'model-card';
        el.innerHTML = `
            <div class="header">
                <div>
                    <div class="title" style="display:flex; align-items:flex-start;">
                        <button class="fav-btn ${isFav ? 'is-fav' : ''}" onclick="toggleFav('${model.id}')" title="Add to Favorites">
                            <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-star"></i>
                        </button>
                        ${model.name}
                    </div>
                    <div class="provider" style="margin-left: 2rem;">${model.id}</div>
                </div>
                <div class="price-tag ${isFree ? 'free' : ''}">${priceDisplay}</div>
            </div>
            <div class="details">
                <div class="context">${contextDisplay}</div>
                <button class="select-btn ${isCurrent ? 'current' : ''}" 
                        onclick="selectModel('${model.id}')" 
                        ${isCurrent ? 'disabled' : ''}>
                    ${isCurrent ? 'Selected' : 'Select'}
                </button>
            </div>
        `;
        grid.appendChild(el);
    });
}

function filterModels() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const freeOnly = document.getElementById('filterFreeBtn').classList.contains('active');
    const favOnly = document.getElementById('filterFavBtn').classList.contains('active');
    const sortValue = document.getElementById('sortSelect').value;
    
    let filtered = allModels.filter(m => {
        const matchSearch = m.name.toLowerCase().includes(search) || m.id.toLowerCase().includes(search);
        
        const pPrompt = parseFloat(m.pricing.prompt) || 0;
        const pComp = parseFloat(m.pricing.completion) || 0;
        const isFree = pPrompt === 0 && pComp === 0;
        
        const matchFree = freeOnly ? isFree : true;
        const matchFav = favOnly ? favorites.includes(m.id) : true;
        
        // ถ้าเรียงแบบ "ถูกไปแพง (เสียเงิน)" เราจะตัดตัวฟรีทิ้งไปเลย
        if (sortValue === 'price_asc' && isFree) return false;
        
        return matchSearch && matchFree && matchFav;
    });
    
    // เรียงลำดับ (Sorting)
    if (sortValue !== 'default') {
        filtered.sort((a, b) => {
            let priceA = (parseFloat(a.pricing.prompt) || 0) + (parseFloat(a.pricing.completion) || 0);
            let priceB = (parseFloat(b.pricing.prompt) || 0) + (parseFloat(b.pricing.completion) || 0);
            
            // ถ้าเป็นโมเดลที่ราคา -1 (Dynamic) ให้โดนเตะไปอยู่ล่างสุดเสมอ
            if (priceA < 0) priceA = Infinity;
            if (priceB < 0) priceB = Infinity;
            
            if (sortValue === 'price_asc') return priceA - priceB;
            if (sortValue === 'price_desc') return priceB === Infinity ? -1 : priceB - priceA;
            return 0;
        });
    } else {
        // Default sort: ให้ตัวที่เป็น Favorite ขึ้นมาอยู่บนสุด
        filtered.sort((a, b) => {
            const aFav = favorites.includes(a.id) ? 1 : 0;
            const bFav = favorites.includes(b.id) ? 1 : 0;
            return bFav - aFav;
        });
    }
    
    renderModels(filtered);
}

async function selectModel(modelId) {
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activeModel: modelId })
        });
        
        if (res.ok) {
            activeModelId = modelId;
            showToast("Model updated successfully!");
            updateActiveModelCard();
            filterModels(); // Re-render to update button states
        }
    } catch (err) {
        console.error('Failed to set model', err);
    }
}

function showToast(msg = "Success!") {
    const toast = document.getElementById('toast');
    toast.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

async function editBudget() {
    const current = document.getElementById('dailyBudget').innerText.replace('$', '');
    const newBudgetStr = prompt("ใส่จำนวนงบรายวันที่ต้องการตั้งค่าใหม่ (หน่วยดอลลาร์):", current);
    
    if (newBudgetStr === null) return; 
    
    const newBudget = parseFloat(newBudgetStr);
    if (isNaN(newBudget) || newBudget < 0) {
        alert("กรุณาใส่ตัวเลขที่ถูกต้องครับ");
        return;
    }
    
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newDailyBudget: newBudget })
        });
        
        if (res.ok) {
            document.getElementById('dailyBudget').innerText = `$${newBudget.toFixed(2)}`;
            showToast("อัปเดตงบรายวันเรียบร้อยแล้ว!");
        }
    } catch (err) {
        console.error('Failed to update budget', err);
        alert("อัปเดตไม่สำเร็จ กรุณาลองใหม่");
    }
}

async function toggleFav(modelId) {
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toggleFavorite: modelId })
        });
        if (res.ok) {
            const index = favorites.indexOf(modelId);
            if (index > -1) {
                favorites.splice(index, 1);
            } else {
                favorites.push(modelId);
            }
            filterModels(); // รีเฟรชหน้าจอเพื่อเรียงลำดับใหม่
        }
    } catch (err) {
        console.error('Failed to toggle favorite', err);
    }
}
