import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { createClient } from 'https://unpkg.com/@supabase/supabase-js@2.39.7/dist/esm/index.js';
import { fetchGeminiCascade } from './api.js';

// --- КОНФИГУРАЦИЯ И ИНИЦИАЛИЗАЦИЯ ИЗ .ENV (NETLIFY) ---
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- ГЛОБАЛЬНОЕ СОСТОЯНИЕ SPA ---
let currentUser = null;
let activeChatId = null;
let activeRole = null;
let globalApiKeys = [];
let localMessagesHistory = [];
let rolesCache = [];

// --- СВЯЗЫВАНИЕ ЭЛЕМЕНТОВ DOM ---
const DOMElements = {
    authScreen: document.getElementById('auth-screen'),
    authEmail: document.getElementById('auth-email'),
    authPassword: document.getElementById('auth-password'),
    btnLogin: document.getElementById('btn-login'),
    btnRegister: document.getElementById('btn-register'),
    authError: document.getElementById('auth-error'),
    sidebar: document.getElementById('sidebar'),
    mainChat: document.getElementById('main-chat'),
    chatList: document.getElementById('chat-list'),
    roleSelector: document.getElementById('role-selector'),
    chatTitle: document.getElementById('chat-title'),
    chatRoleIcon: document.getElementById('chat-role-icon'),
    chatMessages: document.getElementById('chat-messages'),
    welcomeScreen: document.getElementById('welcome-screen'),
    inputMessage: document.getElementById('input-message'),
    btnSend: document.getElementById('btn-send'),
    btnNewChat: document.getElementById('btn-new-chat'),
    btnRoleInfo: document.getElementById('btn-role-info'),
    btnOpenSettings: document.getElementById('btn-open-settings'),
    modalSettings: document.getElementById('modal-settings'),
    keysListContainer: document.getElementById('keys-list-container'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    modalRoleInfo: document.getElementById('modal-role-info'),
    infoRolePrompt: document.getElementById('info-role-prompt'),
    btnUpdateRolePrompt: document.getElementById('btn-update-role-prompt'),
    btnCloseRoleInfo: document.getElementById('btn-close-role-info'),
    btnCreateRoleModal: document.getElementById('btn-create-role-modal'),
    modalCreateRole: document.getElementById('modal-create-role'),
    newRoleName: document.getElementById('new-role-name'),
    newRoleIcon: document.getElementById('new-role-icon'),
    newRolePrompt: document.getElementById('new-role-prompt'),
    btnSaveCustomRole: document.getElementById('btn-save-custom-role'),
    btnCloseCreateRole: document.getElementById('btn-close-create-role'),
    btnLogout: document.getElementById('btn-logout'),
    toastContainer: document.getElementById('toast-container')
};

// --- СЛУШАТЕЛИ АВТОРИЗАЦИИ FIREBASE ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        DOMElements.authScreen.classList.add('hidden');
        DOMElements.sidebar.classList.remove('hidden');
        DOMElements.mainChat.classList.remove('hidden');
        
        await syncUserSession();
        await loadRoles();
        await loadChatsList();
    } else {
        currentUser = null;
        DOMElements.authScreen.classList.remove('hidden');
        DOMElements.sidebar.classList.add('hidden');
        DOMElements.mainChat.classList.add('hidden');
    }
});

DOMElements.btnLogin.addEventListener('click', async () => {
    const email = DOMElements.authEmail.value.trim();
    const pass = DOMElements.authPassword.value;
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
        showToast(err.message, 'error');
    }
});

DOMElements.btnRegister.addEventListener('click', async () => {
    const email = DOMElements.authEmail.value.trim();
    const pass = DOMElements.authPassword.value;
    try {
        await createUserWithEmailAndPassword(auth, email, pass);
    } catch (err) {
        showToast(err.message, 'error');
    }
});

DOMElements.btnLogout.addEventListener('click', () => signOut(auth));

// --- СИНХРОНИЗАЦИЯ ПРОФИЛЯ С SUPABASE ---
async function syncUserSession() {
    const { data, error } = await supabase.from('user_settings').select('api_keys').eq('user_id', currentUser.uid).maybeSingle();
    
    if (error) return showToast("Ошибка синхронизации профиля с БД", "error");

    if (data) {
        globalApiKeys = data.api_keys;
    } else {
        globalApiKeys = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, value: '', invalid: false }));
        await supabase.from('user_settings').insert({ user_id: currentUser.uid, api_keys: globalApiKeys });
    }
}

// Пометка ключа нерабочим в БД при ошибках 400/403
async function handleKeyInvalidation(keyId) {
    const idx = globalApiKeys.findIndex(k => k.id === keyId);
    if (idx !== -1) {
        globalApiKeys[idx].invalid = true;
        await supabase.from('user_settings').update({ api_keys: globalApiKeys }).eq('user_id', currentUser.uid);
    }
}

// --- УПРАВЛЕНИЕ РОЛЯМИ (ПРОМПТАМИ) ---
async function loadRoles() {
    const { data, error } = await supabase.from('custom_roles')
        .select('*')
        .or(`user_id.is.null,user_id.eq.${currentUser.uid}`);
    
    if (error) return showToast("Не удалось загрузить роли", "error");
    
    rolesCache = data;
    DOMElements.roleSelector.innerHTML = '';
    data.forEach(role => {
        const opt = document.createElement('option');
        opt.value = role.id;
        opt.innerText = `${role.icon || '🤖'} ${role.name}`;
        DOMElements.roleSelector.appendChild(opt);
    });
}

DOMElements.btnSaveCustomRole.addEventListener('click', async () => {
    const name = DOMElements.newRoleName.value.trim();
    const icon = DOMElements.newRoleIcon.value;
    const prompt = DOMElements.newRolePrompt.value.trim();

    if (!name || !prompt) return showToast("Заполните все поля роли", "warning");

    const { error } = await supabase.from('custom_roles').insert({
        user_id: currentUser.uid, name, prompt, icon
    });

    if (error) return showToast("Ошибка создания роли", "error");
    
    showToast("Кастомная роль успешно добавлена", "success");
    DOMElements.modalCreateRole.classList.add('hidden');
    DOMElements.newRoleName.value = '';
    DOMElements.newRolePrompt.value = '';
    await loadRoles();
});

// --- СТРУКТУРА ЧАТОВ И ИСТОРИИ ---
async function loadChatsList() {
    const { data, error } = await supabase.from('chats')
        .select('*, custom_roles(name, icon, prompt)')
        .eq('user_id', currentUser.uid)
        .order('created_at', { ascending: false });

    if (error) return showToast("Ошибка загрузки списка чатов", "error");

    DOMElements.chatList.innerHTML = '';
    data.forEach(chat => {
        const item = document.createElement('div');
        item.className = `flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-sm group transition ${chat.id === activeChatId ? 'bg-[#282a2c] text-white' : 'hover:bg-[#282a2c]/50 text-gray-400'}`;
        
        const infoWrapper = document.createElement('div');
        infoWrapper.className = "flex items-center gap-2 overflow-hidden flex-1";
        infoWrapper.innerHTML = `<span>${chat.custom_roles?.icon || '🤖'}</span> <span class="truncate font-medium">${chat.title}</span>`;
        infoWrapper.addEventListener('click', () => selectChat(chat));
        
        const actions = document.createElement('div');
        actions.className = "flex gap-1 opacity-0 group-hover:opacity-100 transition";
        
        const btnRename = document.createElement('button');
        btnRename.innerText = '✏️';
        btnRename.addEventListener('click', (e) => { e.stopPropagation(); renameChat(chat.id, chat.title); });
        
        const btnDelete = document.createElement('button');
        btnDelete.innerText = '🗑️';
        btnDelete.addEventListener('click', (e) => { e.stopPropagation(); deleteChat(chat.id); });

        actions.appendChild(btnRename);
        actions.appendChild(btnDelete);
        item.appendChild(infoWrapper);
        item.appendChild(actions);
        DOMElements.chatList.appendChild(item);
    });
}

DOMElements.btnNewChat.addEventListener('click', async () => {
    const roleId = DOMElements.roleSelector.value;
    if (!roleId) return showToast("Сначала выберите или создайте роль", "warning");

    const selectedRole = rolesCache.find(r => r.id === roleId);

    const { data, error } = await supabase.from('chats').insert({
        user_id: currentUser.uid,
        role_id: roleId,
        title: `Чат с ${selectedRole.name}`
    }).select().single();

    if (error) return showToast("Не удалось создать чат", "error");
    
    await loadChatsList();
    const fullChatData = { ...data, custom_roles: selectedRole };
    selectChat(fullChatData);
});

async function selectChat(chat) {
    activeChatId = chat.id;
    activeRole = chat.custom_roles;

    DOMElements.welcomeScreen.classList.add('hidden');
    DOMElements.btnRoleInfo.classList.remove('hidden');
    DOMElements.inputMessage.removeAttribute('disabled');
    DOMElements.btnSend.removeAttribute('disabled');
    DOMElements.inputMessage.placeholder = "Введите сообщение...";
    DOMElements.chatTitle.innerText = chat.title;
    DOMElements.chatRoleIcon.innerText = activeRole?.icon || '🤖';

    // Загрузка сообщений
    const { data, error } = await supabase.from('messages')
        .select('*')
        .eq('chat_id', activeChatId)
        .order('created_at', { ascending: true });

    if (error) return showToast("Не удалось подгрузить историю сообщений", "error");

    localMessagesHistory = data;
    renderMessagesUI();
    await loadChatsList(); // Обновление активного состояния плашки
}

async function renameChat(id, oldTitle) {
    const newTitle = prompt("Введите новое название чата:", oldTitle);
    if (!newTitle || newTitle.trim() === "") return;

    await supabase.from('chats').update({ title: newTitle.trim() }).eq('id', id);
    if (activeChatId === id) DOMElements.chatTitle.innerText = newTitle;
    await loadChatsList();
}

async function deleteChat(id) {
    if (!confirm("Вы уверены, что хотите удалить этот чат со всей историей?")) return;
    
    await supabase.from('chats').delete().eq('id', id);
    if (activeChatId === id) {
        activeChatId = null;
        activeRole = null;
        localMessagesHistory = [];
        DOMElements.welcomeScreen.classList.remove('hidden');
        DOMElements.btnRoleInfo.classList.add('hidden');
        DOMElements.inputMessage.setAttribute('disabled', true);
        DOMElements.btnSend.setAttribute('disabled', true);
        DOMElements.chatTitle.innerText = "Выберите или создайте чат";
    }
    await loadChatsList();
}

// --- ОТПРАВКА СООБЩЕНИЙ И СБОИ API ---
DOMElements.btnSend.addEventListener('click', handleSendMessage);
DOMElements.inputMessage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
    }
});

async function handleSendMessage() {
    const content = DOMElements.inputMessage.value.trim();
    if (!content || !activeChatId) return;

    DOMElements.inputMessage.value = '';
    
    // Временно выводим в UI сообщение пользователя для живого отклика
    appendSingleMessageUI({ role: 'user', content });
    
    // Генерируем анимацию скелетона ожидания ответа ИИ
    const loaderId = appendSkeletonUI();

    try {
        // Отправляем каскадный запрос к ИИ
        const responseData = await fetchGeminiCascade({
            userMessage: content,
            systemPrompt: activeRole.prompt,
            history: localMessagesHistory,
            apiKeys: globalApiKeys,
            onKeyInvalid: handleKeyInvalidation,
            onToast: showToast
        });

        // В случае успеха — сохраняем ОБА сообщения транзакцией в базу данных Supabase
        const { error } = await supabase.from('messages').insert([
            { chat_id: activeChatId, role: 'user', content: content },
            { chat_id: activeChatId, role: 'model', content: responseData.text }
        ]);

        if (error) throw new Error("Ошибка записи в базу данных сообщений.");

        removeDOMElement(loaderId);
        
        // Добавляем в локальную оперативную память
        localMessagesHistory.push(
            { role: 'user', content: content },
            { role: 'model', content: responseData.text }
        );

        appendSingleMessageUI({ role: 'model', content: responseData.text });

    } catch (err) {
        // ОБРАБОТКА СБОЯ: Удаляем анимацию загрузки и откатываем UI (удаляем последнее сообщение пользователя)
        removeDOMElement(loaderId);
        removeLastUserMessageFromUI();
        showToast(err.message, 'error');
        // Сообщение пользователя НЕ записалось в базу данных Supabase (условие выполнено)
    }
}

// --- ОТРИСОВКА ИНТЕРФЕЙСА СООБЩЕНИЙ ---
function renderMessagesUI() {
    DOMElements.chatMessages.innerHTML = '';
    if (localMessagesHistory.length === 0) {
        DOMElements.chatMessages.innerHTML = `<div class="text-center text-gray-500 text-xs mt-10">История сообщений пуста. Начните диалог первым!</div>`;
        return;
    }
    localMessagesHistory.forEach(msg => appendSingleMessageUI(msg));
}

function appendSingleMessageUI(msg) {
    const wrapper = document.createElement('div');
    wrapper.className = `flex flex-col max-w-[80%] p-4 rounded-2xl animate-fade-in ${
        msg.role === 'user' 
        ? 'bg-[#282a2c] border border-[#37393b] text-white ml-auto rounded-tr-none' 
        : 'bg-[#1e1f20]/40 text-gray-200 mr-auto rounded-tl-none border border-[#282a2c]/60'
    }`;
    
    const label = document.createElement('span');
    label.className = "text-[10px] font-bold uppercase text-gray-500 mb-1";
    label.innerText = msg.role === 'user' ? 'Вы' : (activeRole?.name || 'ИИ');
    
    const textNode = document.createElement('div');
    textNode.className = "text-sm leading-relaxed whitespace-pre-wrap";
    textNode.innerText = msg.content;
    
    wrapper.appendChild(label);
    wrapper.appendChild(textNode);
    DOMElements.chatMessages.appendChild(wrapper);
    DOMElements.chatMessages.scrollTop = DOMElements.chatMessages.scrollHeight;
}

function appendSkeletonUI() {
    const id = `sk-${Date.now()}`;
    const skeleton = document.createElement('div');
    skeleton.id = id;
    skeleton.className = "w-2/3 h-20 rounded-2xl mr-auto skeleton-loader border border-[#282a2c] p-4 flex flex-col gap-2";
    skeleton.innerHTML = `<div class="w-1/4 h-2 bg-gray-700/50 rounded"></div><div class="w-full h-3 bg-gray-700/50 rounded"></div><div class="w-5/6 h-3 bg-gray-700/50 rounded"></div>`;
    DOMElements.chatMessages.appendChild(skeleton);
    DOMElements.chatMessages.scrollTop = DOMElements.chatMessages.scrollHeight;
    return id;
}

function removeDOMElement(id) {
    document.getElementById(id)?.remove();
}

function removeLastUserMessageFromUI() {
    const allUserMessages = DOMElements.chatMessages.querySelectorAll('.ml-auto');
    if (allUserMessages.length > 0) {
        allUserMessages[allUserMessages.length - 1].remove();
    }
}

// --- УПРАВЛЕНИЕ МОДАЛЬНЫМИ ОКНАМИ НАСТРОЕК КЛЮЧЕЙ ---
function renderApiKeysSettings() {
    DOMElements.keysListContainer.innerHTML = '';
    globalApiKeys.forEach(key => {
        const row = document.createElement('div');
        row.className = "flex flex-col gap-1";
        row.innerHTML = `
            <div class="flex justify-between items-center">
                <label class="text-xs font-semibold ${key.invalid ? 'text-red-400' : 'text-gray-400'}">Слот Ключа №${key.id} ${key.invalid ? '(НЕРАБОЧИЙ / ЗАБЛОКИРОВАН)' : ''}</label>
            </div>
            <input type="password" data-id="${key.id}" value="${key.value}" class="w-full p-2.5 bg-[#131314] border rounded-xl text-xs outline-none focus:border-[#1a73e8] transition ${key.invalid ? 'key-input-error' : 'border-[#37393b]'}" placeholder="AIzaSy...">
        `;
        DOMElements.keysListContainer.appendChild(row);
    });
}

DOMElements.btnSaveSettings.addEventListener('click', async () => {
    const inputs = DOMElements.keysListContainer.querySelectorAll('input');
    inputs.forEach(input => {
        const id = parseInt(input.getAttribute('data-id'));
        const val = input.value.trim();
        const found = globalApiKeys.find(k => k.id === id);
        if (found) {
            // Если значение изменилось, сбрасываем флаг невалидности
            if (found.value !== val) {
                found.value = val;
                found.invalid = false;
            }
        }
    });

    const { error } = await supabase.from('user_settings').update({ api_keys: globalApiKeys }).eq('user_id', currentUser.uid);
    if (error) return showToast("Не удалось сохранить ключи в Supabase", "error");

    showToast("Конфигурация ключей успешно обновлена", "success");
    DOMElements.modalSettings.classList.add('hidden');
});

// Открытие / закрытие окон
DOMElements.btnOpenSettings.addEventListener('click', () => { renderApiKeysSettings(); DOMElements.modalSettings.classList.remove('hidden'); });
DOMElements.btnCloseSettings.addEventListener('click', () => DOMElements.modalSettings.classList.add('hidden'));

DOMElements.btnRoleInfo.addEventListener('click', () => {
    DOMElements.infoRolePrompt.value = activeRole?.prompt || '';
    DOMElements.modalRoleInfo.classList.remove('hidden');
});
DOMElements.btnCloseRoleInfo.addEventListener('click', () => DOMElements.modalRoleInfo.classList.add('hidden'));

DOMElements.btnUpdateRolePrompt.addEventListener('click', async () => {
    const updatedPrompt = DOMElements.infoRolePrompt.value.trim();
    if (!updatedPrompt) return showToast("Промпт не может быть пустым", "warning");

    activeRole.prompt = updatedPrompt;
    showToast("Промпт текущего чата обновлен локально на сессию", "success");
    DOMElements.modalRoleInfo.classList.add('hidden');
});

DOMElements.btnCreateRoleModal.addEventListener('click', () => DOMElements.modalCreateRole.classList.remove('hidden'));
DOMElements.btnCloseCreateRole.addEventListener('click', () => DOMElements.modalCreateRole.classList.add('hidden'));

// --- СИСТЕМА УВЕДОМЛЕНИЙ (TOASTS) ---
function showToast(text, type = 'error') {
    const toast = document.createElement('div');
    let bg = 'bg-[#ef4444]';
    if (type === 'success') bg = 'bg-[#10b981]';
    if (type === 'warning') bg = 'bg-[#f59e0b]';

    toast.className = `${bg} text-white text-xs px-4 py-3 rounded-xl shadow-2xl font-medium animate-fade-in flex items-center gap-2 border border-white/10`;
    toast.innerText = text;
    
    DOMElements.toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.4s ease';
        setTimeout(() => toast.remove(), 400);
    }, 4500);
}