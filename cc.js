const firebaseConfig = {
  apiKey: "AIzaSyDPjDf242bSDNi3lELsp5Ze0wxKCX97TyM",
  authDomain: "recipe-book-c48a8.firebaseapp.com",
  projectId: "recipe-book-c48a8",
  storageBucket: "recipe-book-c48a8.firebasestorage.app",
  messagingSenderId: "816849963027",
  appId: "1:816849963027:web:ea712d243cab2892e257e6",
  measurementId: "G-K78S0K2RKG"
};


firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Короткий помощник вместо document.getElementById
const $ = id => document.getElementById(id);

// Категории и иконка для карточки
const CATS = {
  "Завтраки": "🍳",
  "Супы": "🍲",
  "Горячее": "🍖",
  "Салаты": "🥗",
  "Выпечка": "🥐",
  "Десерты": "🍰",
  "Напитки": "🥤"
};

const PAGE = 6;          // рецептов на одной странице

let profile = null;      // профиль текущего пользователя
let items = [];          // рецепты текущей страницы
let unsub = null;        // отписка от onSnapshot
let favIds = [];         // id избранных рецептов

// ---- состояние пагинации ----
let currentPage = 1;     // номер открытой страницы
let pageCursors = [];    // документы-закладки: с какого начинается каждая страница
let totalPages = 1;      // всего страниц
let totalItems = 0;      // всего рецептов под текущий фильтр

// Заполняем выпадающие списки категорий
Object.keys(CATS).forEach(c => {
  $("f-cat").innerHTML += `<option>${c}</option>`;
  $("a-cat").innerHTML += `<option>${c}</option>`;
});

// ===== Быстрые кнопки категорий (чипы) =====
function buildChips() {
  const all = ["Все", ...Object.keys(CATS)];

  $("chips").innerHTML = all.map(c => {
    const value = c === "Все" ? "" : c;
    const icon = CATS[c] ? CATS[c] + " " : "";
    return `<button class="chip" data-cat="${value}">${icon}${c}</button>`;
  }).join("");

  document.querySelectorAll(".chip").forEach(chip => {
    chip.onclick = () => {
      $("f-cat").value = chip.dataset.cat;
      markActiveChip();
      reload();
    };
  });

  markActiveChip();
}

function markActiveChip() {
  document.querySelectorAll(".chip").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.cat === $("f-cat").value);
  });
}

buildChips();

// ===== Счётчик рецептов для приветственного экрана =====
db.collection("recipes").select().get()
  .then(snap => { $("stat-count").textContent = snap.size; })
  .catch(() => { $("stat-count").textContent = "—"; });

// ===== Показ форм =====
$("btn-show-login").onclick = () => {
  $("login-panel").classList.remove("hidden");
  $("register-panel").classList.add("hidden");
};

$("btn-show-register").onclick = () => {
  $("register-panel").classList.remove("hidden");
  $("login-panel").classList.add("hidden");
};

// ===== Регистрация =====
$("btn-register").onclick = () => {
  $("reg-err").textContent = "";
  const name = $("reg-name").value.trim();

  auth.createUserWithEmailAndPassword($("reg-email").value.trim(), $("reg-pass").value)
    .then(cred => db.collection("users").doc(cred.user.uid).set({
      email: cred.user.email,
      name: name,
      role: "user",
      createdAt: new Date().toLocaleDateString("ru-RU")
    }))
    .then(() => logAction(LOG_TYPES.AUTH, "зарегистрировался на сайте", ""))
    .catch(e => $("reg-err").textContent = e.message);
};

// ===== Вход =====
$("btn-login").onclick = () => {
  $("login-err").textContent = "";
  $("login-ok").textContent = "";
  auth.signInWithEmailAndPassword($("login-email").value.trim(), $("login-pass").value)
    .then(() => logAction(LOG_TYPES.AUTH, "вошёл в аккаунт", ""))
    .catch(e => $("login-err").textContent = e.message);
};

// ===== Сброс пароля =====
$("btn-reset").onclick = () => {
  $("login-err").textContent = "";
  $("login-ok").textContent = "";
  auth.sendPasswordResetEmail($("login-email").value.trim())
    .then(() => $("login-ok").textContent = "Письмо отправлено на почту")
    .catch(e => $("login-err").textContent = e.message);
};

// ===== Выход =====
$("btn-logout").onclick = () => auth.signOut();

// ===== Слежение за авторизацией =====
auth.onAuthStateChanged(user => {
  $("login-panel").classList.add("hidden");
  $("register-panel").classList.add("hidden");

  if (user) {
    $("guest").classList.add("hidden");
    $("logged").classList.remove("hidden");
    $("profile-panel").classList.remove("hidden");

    db.collection("users").doc(user.uid).get().then(doc => {
      profile = doc.data() || {};
      $("user-name").textContent = profile.name || user.email;
      $("p-email").textContent = profile.email || user.email;
      $("p-name").textContent = profile.name || "—";
      $("p-role").textContent = profile.role === "admin" ? "администратор" : "пользователь";
      $("admin-panel").classList.toggle("hidden", profile.role !== "admin");
      $("nav-admin").classList.toggle("hidden", profile.role !== "admin");
      loadFavorites();
    });
  } else {
    $("guest").classList.remove("hidden");
    $("logged").classList.add("hidden");
    $("profile-panel").classList.add("hidden");
    $("admin-panel").classList.add("hidden");
    profile = null;
    favIds = [];
    reload();
  }
});

// ===== Избранное =====
function loadFavorites() {
  db.collection("favorites").where("userId", "==", auth.currentUser.uid).get()
    .then(snap => {
      favIds = snap.docs.map(d => d.data().recipeId);
      reload();
    })
    .catch(e => { console.error(e); reload(); });
}

function toggleFav(id, title) {
  const user = auth.currentUser;
  if (!user) { alert("Войдите, чтобы сохранять рецепты"); return; }

  const favDoc = db.collection("favorites").doc(user.uid + "_" + id);

  if (favIds.includes(id)) {
    favDoc.delete()
      .then(() => logAction(LOG_TYPES.FAVORITE, "убрал из избранного", title))
      .then(loadFavorites);
  } else {
    favDoc.set({
      userId: user.uid,
      recipeId: id,
      title: title,
      date: new Date().toLocaleDateString("ru-RU"),
      addedAt: new Date()
    })
      .then(() => logAction(LOG_TYPES.FAVORITE, "сохранил в избранное", title))
      .then(loadFavorites);
  }
}

// ===== Добавление рецепта (только админ) =====
$("btn-add").onclick = () => {
  $("a-err").textContent = "";
  const title = $("a-title").value.trim();
  if (!title) { $("a-err").textContent = "Введите название"; return; }

  // Текст из textarea превращаем в массив: каждая строка — отдельный пункт
  const toList = text => text.split("\n").map(s => s.trim()).filter(s => s);

  db.collection("recipes").add({
    title: title,
    titleLower: title.toLowerCase(),
    description: $("a-desc").value.trim(),
    category: $("a-cat").value,
    cookTime: Number($("a-time").value) || 30,
    imageURL: $("a-img").value.trim(),
    ingredients: toList($("a-ing").value),
    steps: toList($("a-steps").value),
    rating: 0,
    ratingsCount: 0,
    authorName: (profile && (profile.name || profile.email)) || "admin",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => {
    logAction(LOG_TYPES.ADMIN, "добавил рецепт", title);
    ["a-title", "a-desc", "a-time", "a-img", "a-ing", "a-steps"].forEach(id => $(id).value = "");
    reload();   // пересчитываем страницы: рецептов стало больше
  }).catch(e => $("a-err").textContent = e.message);
};

function delRecipe(id) {
  if (!confirm("Удалить рецепт?")) return;

  const r = items.find(x => x.id === id);

  db.collection("recipes").doc(id).delete()
    .then(() => logAction(LOG_TYPES.ADMIN, "удалил рецепт", r ? r.title : id))
    .then(reload)
    .catch(e => alert(e.message));
}

// ============================================
//  ПАГИНАЦИЯ ПО НОМЕРАМ СТРАНИЦ
// ============================================

// Запрос без ограничения количества — общий для всех страниц
function baseQuery() {
  let q = db.collection("recipes");
  const term = $("f-search").value.trim().toLowerCase();
  const cat = $("f-cat").value;

  if (cat) q = q.where("category", "==", cat);

  if (term) {
    q = q.where("titleLower", ">=", term)
         .where("titleLower", "<=", term + "")
         .orderBy("titleLower");
  } else if ($("f-sort").value === "cookTime") {
    q = q.orderBy("cookTime");
  } else {
    q = q.orderBy("createdAt", "desc");
  }

  return q;
}

// Шаг 1: узнаём, сколько всего рецептов и с какого документа
// начинается каждая страница. Эти документы — закладки (курсоры).
function buildPageIndex() {
  return baseQuery().get().then(snap => {
    totalItems = snap.size;
    totalPages = Math.max(1, Math.ceil(totalItems / PAGE));

    // Каждый PAGE-й документ — начало новой страницы
    pageCursors = [];
    for (let i = 0; i < snap.docs.length; i += PAGE) {
      pageCursors.push(snap.docs[i]);
    }
  });
}

// Шаг 2: грузим конкретную страницу, начиная с её закладки
function loadPage(n) {
  if (n < 1 || n > totalPages) return;
  currentPage = n;

  if (unsub) unsub();   // отписываемся от предыдущей страницы

  $("state").textContent = "Загрузка...";
  $("state").classList.remove("hidden");

  const startDoc = pageCursors[n - 1];
  let q = baseQuery();

  // startAt — начать С этого документа (включая его)
  if (startDoc) q = q.startAt(startDoc);

  // onSnapshot вместо get: страница обновляется в реальном времени
  unsub = q.limit(PAGE).onSnapshot(snap => {
    items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
    renderPager();
  }, e => {
    console.error("Firestore:", e);
    $("state").textContent = "Ошибка: " + e.message;
    $("state").classList.remove("hidden");
  });
}

// Пересчёт с нуля — при смене фильтра, поиска, сортировки
function reload() {
  buildPageIndex()
    .then(() => loadPage(1))
    .catch(e => {
      $("state").textContent = "Ошибка: " + e.message;
      $("state").classList.remove("hidden");
      console.error(e);
    });
}

// Рисуем панель с номерами
function renderPager() {
  if (totalPages <= 1) {
    $("pager").innerHTML = "";
    $("pager-info").textContent = totalItems ? `Всего рецептов: ${totalItems}` : "";
    return;
  }

  let html = "";

  // стрелка назад
  html += `<button class="page-btn" ${currentPage === 1 ? "disabled" : ""}
             onclick="loadPage(${currentPage - 1})">←</button>`;

  // показываем максимум 5 номеров вокруг текущего
  let from = Math.max(1, currentPage - 2);
  let to = Math.min(totalPages, from + 4);
  from = Math.max(1, to - 4);

  if (from > 1) {
    html += `<button class="page-btn" onclick="loadPage(1)">1</button>`;
    if (from > 2) html += `<span class="page-dots">…</span>`;
  }

  for (let i = from; i <= to; i++) {
    html += `<button class="page-btn ${i === currentPage ? "active" : ""}"
               onclick="loadPage(${i})">${i}</button>`;
  }

  if (to < totalPages) {
    if (to < totalPages - 1) html += `<span class="page-dots">…</span>`;
    html += `<button class="page-btn" onclick="loadPage(${totalPages})">${totalPages}</button>`;
  }

  // стрелка вперёд
  html += `<button class="page-btn" ${currentPage === totalPages ? "disabled" : ""}
             onclick="loadPage(${currentPage + 1})">→</button>`;

  $("pager").innerHTML = html;

  const first = (currentPage - 1) * PAGE + 1;
  const last = Math.min(currentPage * PAGE, totalItems);
  $("pager-info").textContent = `${first}–${last} из ${totalItems}`;
}

// ===== Отрисовка карточек =====
function render() {
  if (!items.length) {
    $("grid").innerHTML = "";
    $("state").textContent = "Рецепты не найдены.";
    $("state").classList.remove("hidden");
    return;
  }

  $("state").classList.add("hidden");

  $("grid").innerHTML = items.map(r => {
    const icon = CATS[r.category] || "🍽";
    const safeTitle = (r.title || "").replace(/'/g, "");
    const isFav = favIds.includes(r.id);
    const adminBtn = (profile && profile.role === "admin")
      ? `<button class="btn-red" onclick="delRecipe('${r.id}')">Удалить</button>`
      : "";

    return `
      <div class="card">
        <a href="rec.html?id=${r.id}">
          <div class="card-img">
            ${r.imageURL
              ? `<img src="${r.imageURL.replace(/"/g, "")}" alt="${safeTitle}" loading="lazy">`
              : icon}
            <span class="time-pill">⏱ ${r.cookTime} мин</span>
          </div>
        </a>
        <div class="card-body">
          <h3><a href="rec.html?id=${r.id}">${r.title}</a></h3>
          <p>${r.description || ""}</p>
          <div class="meta">
            <span class="badge">${r.category || "—"}</span>
            ${r.rating ? `★ ${r.rating.toFixed(1)}` : "нет оценок"}
          </div>
          <div class="card-btns">
            <button onclick="toggleFav('${r.id}', '${safeTitle}')">
              ${isFav ? "★ В избранном" : "☆ Сохранить"}
            </button>
            ${adminBtn}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// ===== Фильтры и поиск =====
$("f-cat").onchange = () => { markActiveChip(); reload(); };
$("f-sort").onchange = reload;

let searchTimer;
$("f-search").oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(reload, 400);
};

// Функции вызываются из onclick внутри сгенерированного HTML,
// поэтому делаем их доступными глобально
window.toggleFav = toggleFav;
window.delRecipe = delRecipe;
window.loadPage = loadPage;

reload();