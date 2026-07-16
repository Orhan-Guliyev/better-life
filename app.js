// === КОНФИГУРАЦИЯ SUPABASE ===
const SUPABASE_URL = 'https://lcxbcxagitcilklmniwe.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_secret_OKHVhL5J3aYPeGtjzABiUw_FC8op5yF'; 

// ПЕРЕИМЕНОВАЛИ ИЗ supabase В supabaseClient, чтобы не было конфликта имен
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let userApiKeys = [];
let currentPersona = null;

const GEMINI_MODELS = [
    'gemini-1.5-pro-latest',
    'gemini-1.5-flash-latest',
    'gemini-1.0-pro'
];

// === СЛУШАТЕЛЬ СЕССИИ (Supabase Auth) ===
// Замени везде по коду 'supabase.' на 'supabaseClient.'
supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (session) {
        currentUser = session.user;
        document.getElementById('auth-screen').classList.add('hidden');
        await checkApiKeys();
    } else {
        currentUser = null;
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('app-screen').classList.add('hidden');
    }
});

// Вход
document.getElementById('btn-login').addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) alert("Ошибка входа: " + error.message);
});

// Регистрация
document.getElementById('btn-register').addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const { error } = await supabaseClient.auth.signUp({ email, password });
    if (error) alert("Ошибка регистрации: " + error.message);
    else alert("Регистрация успешна!");
});

// Выход
document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
});

// === ЛОГИКА API КЛЮЧЕЙ ===
async function checkApiKeys() {
    const { data, error } = await supabaseClient.from('api_keys').select('key_value');
    
    if (data && data.length > 0) {
        userApiKeys = data.map(k => k.key_value);
        document.getElementById('api-key-modal').classList.add('hidden');
        startApp();
    } else {
        document.getElementById('api-key-modal').classList.remove('hidden');
    }
}

document.getElementById('btn-add-key').addEventListener('click', async () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) return;
    
    if (userApiKeys.length >= 5) {
        alert("Максимум можно добавить 5 ключей!");
        return;
    }
    
    const { error } = await supabaseClient.from('api_keys').insert([{ user_id: currentUser.id, key_value: key }]);
    
    if (error) {
        alert("Ошибка добавления: " + error.message);
    } else {
        userApiKeys.push(key);
        document.getElementById('keys-list').innerHTML += `<li>Ключ добавлен (всего: ${userApiKeys.length})</li>`;
        document.getElementById('api-key-input').value = '';
        document.getElementById('btn-finish-keys').classList.remove('hidden');
    }
});