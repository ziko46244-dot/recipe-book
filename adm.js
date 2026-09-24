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

const $ = id => document.getElementById(id);

const CATS = ["Завтраки", "Супы", "Горячее", "Салаты", "Выпечка", "Десерты", "Напитки"];

let uid = null;
let profile = null;
let editingId = null;   // id редактируемого рецепта, null = режим добавления
let allRecipes = [];    // кэш списка для фильтрации без лишних запросов

CATS.forEach(c => $("a-cat").innerHTML += `<option>${c}</option>`);

// ===== Проверка прав =====
auth.onAuthStateChanged(user => {
  if (!user) {
    $("admin-page").classList.add("hidden");
    $("no-access").classList.remove("hidden");
    return;
  }

  uid = user.uid;

  db.collection("users").doc(uid).get().then(doc => {
    profile = doc.data() || {};
    $("user-name").textContent = profile.name || user.email;

    // Это защита интерфейса, а не данных.
    // Настоящая защита — в правилах безопасности Firestore.
    if (profile.role !== "admin") {
      $("admin-page").classList.add("hidden");
      $("no-access").classList.remove("hidden");
      return;
    }

    $("no-access").classList.add("hidden");
    $("admin-page").classList.remove("hidden");

    loadStats();
    loadRecipes();
    loadUsers();
    loadReviews();
    loadLogs();
  });
});

$("btn-logout").onclick = () => auth.signOut().then(() => location.href = "cc.html");

// ===== Статистика =====
// select() без полей — забираем только id документов, экономим трафик
function loadStats() {
  db.collection("recipes").select().get().then(s => $("s-recipes").textContent = s.size);
  db.collection("users").select().get().then(s => $("s-users").textContent = s.size);
  db.collection("collections").select().get().then(s => $("s-cols").textContent = s.size);
  db.collectionGroup("reviews").select().get()
    .then(s => $("s-reviews").textContent = s.size)
    .catch(() => $("s-reviews").textContent = "—");
}

// ===== CRUD рецептов =====
const toList = text => text.split("\n").map(s => s.trim()).filter(s => s);

// Создание или обновление — одна кнопка на оба режима
$("btn-save").onclick = () => {
  $("a-err").textContent = "";
  $("a-ok").textContent = "";

  const title = $("a-title").value.trim();
  if (!title) { $("a-err").textContent = "Введите название"; return; }

  const data = {
    title: title,
    titleLower: title.toLowerCase(),
    description: $("a-desc").value.trim(),
    category: $("a-cat").value,
    cookTime: Number($("a-time").value) || 30,
    imageURL: $("a-img").value.trim(),
    ingredients: toList($("a-ing").value),
    steps: toList($("a-steps").value)
  };

  if (editingId) {
    // UPDATE — рейтинг и дату создания не трогаем
    db.collection("recipes").doc(editingId).update(data)
      .then(() => {
        logAction(LOG_TYPES.ADMIN, "отредактировал рецепт", title);
        $("a-ok").textContent = "Рецепт обновлён";
        resetForm();
        loadRecipes();
      })
      .catch(e => $("a-err").textContent = e.message);
  } else {
    // CREATE
    db.collection("recipes").add({
      ...data,
      rating: 0,
      ratingsCount: 0,
      authorName: profile.name || profile.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
      logAction(LOG_TYPES.ADMIN, "добавил рецепт", title);
      $("a-ok").textContent = "Рецепт добавлен";
      resetForm();
      loadRecipes();
      loadStats();
    }).catch(e => $("a-err").textContent = e.message);
  }
};

// Заполняем форму данными рецепта для редактирования
function editRecipe(id) {
  const r = allRecipes.find(x => x.id === id);
  if (!r) return;

  editingId = id;
  $("form-title").textContent = "Редактирование: " + r.title;
  $("a-title").value = r.title || "";
  $("a-desc").value = r.description || "";
  $("a-cat").value = r.category || CATS[0];
  $("a-time").value = r.cookTime || "";
  $("a-img").value = r.imageURL || "";
  $("a-ing").value = (r.ingredients || []).join("\n");
  $("a-steps").value = (r.steps || []).join("\n");

  $("btn-save").textContent = "Сохранить изменения";
  $("btn-cancel").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  editingId = null;
  $("form-title").textContent = "Добавить рецепт";
  ["a-title", "a-desc", "a-time", "a-img", "a-ing", "a-steps"].forEach(id => $(id).value = "");
  $("btn-save").textContent = "Добавить рецепт";
  $("btn-cancel").classList.add("hidden");
}

$("btn-cancel").onclick = () => { resetForm(); $("a-ok").textContent = ""; };

// DELETE
function delRecipe(id, title) {
  if (!confirm(`Удалить рецепт «${title}»?`)) return;

  db.collection("recipes").doc(id).delete()
    .then(() => logAction(LOG_TYPES.ADMIN, "удалил рецепт", title))
    .then(() => { loadRecipes(); loadStats(); })
    .catch(e => alert(e.message));
}

// READ — список с обновлением в реальном времени
function loadRecipes() {
  db.collection("recipes").orderBy("createdAt", "desc").onSnapshot(snap => {
    allRecipes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRecipes();
    $("s-recipes").textContent = snap.size;
  }, e => {
    $("admin-recipes").innerHTML = `<p class="err">Ошибка: ${e.message}</p>`;
  });
}

function renderRecipes() {
  const term = $("admin-search").value.trim().toLowerCase();
  const list = term
    ? allRecipes.filter(r => (r.titleLower || "").includes(term))
    : allRecipes;

  if (!list.length) {
    $("admin-recipes").innerHTML = `<p class="muted">Ничего не найдено.</p>`;
    return;
  }

  $("admin-recipes").innerHTML = list.map(r => `
    <div class="review">
      <div class="review-head">
        <b>${r.title}</b>
        <span class="badge">${r.category || "—"}</span>
        <span class="muted">⏱ ${r.cookTime} мин · ★ ${(r.rating || 0).toFixed(1)}</span>
      </div>
      <p class="muted">${r.description || ""}</p>
      <button class="btn-gray btn-sm" onclick="editRecipe('${r.id}')">Редактировать</button>
      <button class="btn-red btn-sm"
        onclick="delRecipe('${r.id}','${(r.title || '').replace(/'/g, '')}')">Удалить</button>
    </div>
  `).join("");
}

$("admin-search").oninput = renderRecipes;

// ===== Пользователи и роли =====
function loadUsers() {
  db.collection("users").onSnapshot(snap => {
    $("admin-users").innerHTML = snap.docs.map(d => {
      const u = d.data();
      const isMe = d.id === uid;
      const isAdmin = u.role === "admin";

      // Себе роль менять нельзя — иначе можно случайно остаться без админа
      const btn = isMe
        ? `<span class="muted">это вы</span>`
        : `<button class="${isAdmin ? "btn-red" : ""} btn-sm"
             onclick="setRole('${d.id}','${isAdmin ? "user" : "admin"}')">
             ${isAdmin ? "Снять админа" : "Сделать админом"}
           </button>`;

      return `
        <div class="review">
          <div class="review-head">
            <b>${u.name || "без имени"}</b>
            <span class="muted">${u.email}</span>
            <span class="badge" style="${isAdmin ? "background:#e2562c;color:#fff" : ""}">
              ${u.role || "user"}
            </span>
          </div>
          ${btn}
        </div>
      `;
    }).join("");

    $("s-users").textContent = snap.size;
  }, e => {
    $("admin-users").innerHTML = `<p class="err">Ошибка: ${e.message}</p>`;
  });
}

function setRole(userId, role) {
  if (!confirm(`Назначить роль «${role}»?`)) return;
  db.collection("users").doc(userId).update({ role: role })
    .then(() => logAction(LOG_TYPES.ADMIN, `назначил роль «${role}» пользователю`, userId))
    .catch(e => alert(e.message));
}

// ===== Модерация отзывов =====
function loadReviews() {
  db.collectionGroup("reviews").orderBy("createdAt", "desc").limit(20).onSnapshot(snap => {
    if (snap.empty) {
      $("admin-reviews").innerHTML = `<p class="muted">Отзывов пока нет.</p>`;
      return;
    }

    $("admin-reviews").innerHTML = snap.docs.map(d => {
      const r = d.data();
      const recipeId = d.ref.parent.parent.id;
      const stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);

      return `
        <div class="review">
          <div class="review-head">
            <b>${r.userName || "Пользователь"}</b>
            <span class="stars">${stars}</span>
            <span class="muted">${r.date || ""}</span>
            <a href="rec.html?id=${recipeId}" class="back-link">к рецепту →</a>
          </div>
          <p>${r.text}</p>
          <button class="btn-red btn-sm"
            onclick="delReview('${recipeId}','${d.id}')">Удалить отзыв</button>
        </div>
      `;
    }).join("");
  }, e => {
    $("admin-reviews").innerHTML =
      `<p class="err">Ошибка: ${e.message}<br>
       Если есть ссылка «create index» — откройте её и создайте индекс.</p>`;
  });
}

function delReview(recipeId, reviewId) {
  if (!confirm("Удалить отзыв?")) return;
  db.collection("recipes").doc(recipeId).collection("reviews").doc(reviewId).delete()
    .then(() => logAction(LOG_TYPES.ADMIN, "удалил отзыв (модерация)", ""))
    .then(loadStats)
    .catch(e => alert(e.message));
}

// ============================================
//  Журнал действий всех пользователей
// ============================================

let allLogs = [];       // все записи журнала
let logsShown = 15;     // сколько показано сейчас

function loadLogs() {
  // Читаем журнал целиком и сортируем на клиенте по createdAtMs —
  // так фильтры по пользователю и типу не требуют составных индексов
  db.collection("logs").onSnapshot(snap => {
    allLogs = snap.docs.slice()
      .sort((a, b) => (b.data().createdAtMs || 0) - (a.data().createdAtMs || 0));

    fillUserFilter();
    renderAdminLogs();
  }, e => {
    $("admin-logs").innerHTML = `<p class="err">Ошибка: ${e.message}</p>`;
  });
}

// Заполняем список пользователей теми, кто реально что-то делал
function fillUserFilter() {
  const seen = {};
  allLogs.forEach(d => {
    const l = d.data();
    seen[l.userId] = l.userName || l.userEmail;
  });

  const current = $("log-user").value;

  $("log-user").innerHTML = `<option value="">Все пользователи</option>` +
    Object.keys(seen).map(id => `<option value="${id}">${seen[id]}</option>`).join("");

  $("log-user").value = current;   // сохраняем выбранное после обновления
}

function renderAdminLogs() {
  const userFilter = $("log-user").value;
  const typeFilter = $("log-type").value;

  let list = allLogs;
  if (userFilter) list = list.filter(d => d.data().userId === userFilter);
  if (typeFilter) list = list.filter(d => d.data().type === typeFilter);

  if (!list.length) {
    $("admin-logs").innerHTML = `<p class="muted">Записей не найдено.</p>`;
    $("btn-logs-more").classList.add("hidden");
    return;
  }

  $("admin-logs").innerHTML = renderLogs(list.slice(0, logsShown), true);
  $("btn-logs-more").classList.toggle("hidden", list.length <= logsShown);
}

$("log-user").onchange = () => { logsShown = 15; renderAdminLogs(); };
$("log-type").onchange = () => { logsShown = 15; renderAdminLogs(); };
$("btn-logs-more").onclick = () => { logsShown += 15; renderAdminLogs(); };

window.editRecipe = editRecipe;
window.delRecipe = delRecipe;
window.setRole = setRole;
window.delReview = delReview;