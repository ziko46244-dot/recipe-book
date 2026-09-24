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

const CATS = {
  "Завтраки": "🍳", "Супы": "🍲", "Горячее": "🍖", "Салаты": "🥗",
  "Выпечка": "🥐", "Десерты": "🍰", "Напитки": "🥤"
};

let uid = null;
let profile = null;
let favs = [];      // текущее избранное
let unsub = null;

// ===== Авторизация =====
auth.onAuthStateChanged(user => {
  if (!user) {
    $("fav-page").classList.add("hidden");
    $("need-login").classList.remove("hidden");
    if (unsub) unsub();
    return;
  }

  uid = user.uid;
  $("need-login").classList.add("hidden");
  $("fav-page").classList.remove("hidden");

  db.collection("users").doc(uid).get().then(doc => {
    profile = doc.data() || {};
    $("user-name").textContent = profile.name || user.email;
    $("nav-admin").classList.toggle("hidden", profile.role !== "admin");
  });

  loadFavorites();
});

$("btn-logout").onclick = () => auth.signOut().then(() => location.href = "cc.html");

// ===== Избранное в реальном времени =====
function loadFavorites() {
  if (unsub) unsub();

  unsub = db.collection("favorites")
    .where("userId", "==", uid)
    .onSnapshot(snap => {
      favs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      $("fav-count").textContent = favs.length;
      render();
    }, e => {
      $("state").textContent = "Ошибка: " + e.message;
      $("state").classList.remove("hidden");
    });
}

function render() {
  if (!favs.length) {
    $("grid").innerHTML = "";
    $("state").textContent = "В избранном пусто. Сохраните рецепты в каталоге.";
    $("state").classList.remove("hidden");
    $("finalize-panel").classList.add("hidden");
    return;
  }

  $("state").classList.add("hidden");
  $("finalize-panel").classList.remove("hidden");

  $("grid").innerHTML = favs.map(f => {
    const icon = CATS[f.category] || "🍽";
    const img = f.imageURL
      ? `<img src="${String(f.imageURL).replace(/"/g, "")}" alt="" loading="lazy">`
      : icon;

    return `
      <div class="card">
        <a href="rec.html?id=${f.recipeId}"><div class="card-img">${img}</div></a>
        <div class="card-body">
          <h3><a href="rec.html?id=${f.recipeId}">${f.title}</a></h3>
          <p class="muted">Сохранено: ${f.date || "—"}</p>
          <div class="card-btns">
            <button class="btn-red" onclick="removeFav('${f.id}')">Убрать</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// ===== Управление: удаление из избранного =====
function removeFav(favId) {
  const f = favs.find(x => x.id === favId);

  db.collection("favorites").doc(favId).delete()
    .then(() => logAction(LOG_TYPES.FAVORITE, "убрал из избранного", f ? f.title : ""))
    .catch(e => alert(e.message));
}

// ===== Финализация: собрать подборку =====
// Данные перемещаются из "активных действий" (favorites)
// в "историю действий" (collections) — требование ТЗ
$("btn-finalize").onclick = () => {
  $("col-err").textContent = "";
  $("col-ok").textContent = "";

  const name = $("col-name").value.trim();
  if (!name) { $("col-err").textContent = "Введите название подборки"; return; }
  if (!favs.length) { $("col-err").textContent = "Избранное пустое"; return; }

  db.collection("collections").add({
    userId: uid,
    name: name,
    recipeIds: favs.map(f => f.recipeId),
    recipeTitles: favs.map(f => f.title),   // дублируем названия, чтобы не читать рецепты
    status: "собрана",
    date: new Date().toLocaleDateString("ru-RU"),
    createdAtMs: Date.now(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => {
    logAction(LOG_TYPES.COLLECTION, "собрал подборку", name);
    $("col-name").value = "";
    $("col-ok").textContent = "Подборка сохранена. Смотрите её в личном кабинете.";
  }).catch(e => $("col-err").textContent = e.message);
};

window.removeFav = removeFav;