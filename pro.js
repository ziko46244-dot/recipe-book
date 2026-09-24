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

let profile = null;
let uid = null;

// ===== Вход в кабинет =====
auth.onAuthStateChanged(user => {
  if (!user) {
    $("cabinet").classList.add("hidden");
    $("need-login").classList.remove("hidden");
    return;
  }

  uid = user.uid;
  $("need-login").classList.add("hidden");
  $("cabinet").classList.remove("hidden");

  db.collection("users").doc(uid).get().then(doc => {
    profile = doc.data() || {};
    $("user-name").textContent = profile.name || user.email;
    $("p-email").textContent = profile.email || user.email;
    $("p-role").textContent = profile.role === "admin" ? "администратор" : "пользователь";
    $("p-created").textContent = profile.createdAt || "—";
    $("p-name").value = profile.name || "";
    $("p-city").value = profile.city || "";
    $("nav-admin").classList.toggle("hidden", profile.role !== "admin");
  });

  loadStats();
  loadMyReviews();
  loadMyCollections();
  loadMyLogs();
});

$("btn-logout").onclick = () => auth.signOut().then(() => location.href = "cc.html");

// ===== Сохранение профиля =====
$("btn-save").onclick = () => {
  $("p-err").textContent = "";
  $("p-ok").textContent = "";

  const name = $("p-name").value.trim();
  if (!name) { $("p-err").textContent = "Имя не может быть пустым"; return; }

  // Роль НЕ трогаем — её менять может только админ через админку
  db.collection("users").doc(uid).update({
    name: name,
    city: $("p-city").value.trim()
  }).then(() => {
    logAction(LOG_TYPES.PROFILE, "изменил данные профиля", name);
    $("p-ok").textContent = "Сохранено";
    $("user-name").textContent = name;
  }).catch(e => $("p-err").textContent = e.message);
};

// ===== Счётчики активности =====
function loadStats() {
  // Оптимизация: select() без аргументов не тянет поля документов,
  // нам нужно только количество
  db.collection("favorites").where("userId", "==", uid).select().get()
    .then(s => $("s-fav").textContent = s.size);

  db.collectionGroup("reviews").where("userId", "==", uid).select().get()
    .then(s => $("s-rev").textContent = s.size)
    .catch(() => $("s-rev").textContent = "—");

  db.collection("collections").where("userId", "==", uid).select().get()
    .then(s => $("s-col").textContent = s.size);
}

// ===== Мои отзывы (по всем рецептам сразу) =====
function loadMyReviews() {
  // collectionGroup ищет во ВСЕХ подколлекциях reviews сразу
  db.collectionGroup("reviews").where("userId", "==", uid).get()
    .then(snap => {
      if (snap.empty) {
        $("my-reviews").innerHTML = `<p class="muted">Вы пока не оставили ни одного отзыва.</p>`;
        return;
      }

      $("my-reviews").innerHTML = snap.docs.map(d => {
        const r = d.data();
        // путь вида recipes/{recipeId}/reviews/{reviewId}
        const recipeId = d.ref.parent.parent.id;
        const stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);

        return `
          <div class="review" id="rev-${d.id}">
            <div class="review-head">
              <span class="stars">${stars}</span>
              <span class="muted">${r.date || ""}</span>
              <a href="rec.html?id=${recipeId}" class="back-link">к рецепту →</a>
            </div>
            <p id="txt-${d.id}">${r.text}</p>
            <button class="btn-gray btn-sm"
              onclick="editReview('${recipeId}','${d.id}')">Изменить</button>
            <button class="btn-red btn-sm"
              onclick="delReview('${recipeId}','${d.id}')">Удалить</button>
          </div>
        `;
      }).join("");
    })
    .catch(e => {
      $("my-reviews").innerHTML =
        `<p class="err">Ошибка: ${e.message}<br>
         Если в тексте есть ссылка «create index» — откройте её и создайте индекс.</p>`;
    });
}

// Редактирование своего отзыва
function editReview(recipeId, reviewId) {
  const current = $("txt-" + reviewId).textContent;
  const text = prompt("Изменить отзыв:", current);
  if (text === null || !text.trim()) return;

  db.collection("recipes").doc(recipeId).collection("reviews").doc(reviewId)
    .update({ text: text.trim() })
    .then(() => logAction(LOG_TYPES.REVIEW, "отредактировал свой отзыв", ""))
    .then(loadMyReviews)
    .catch(e => alert(e.message));
}

// Удаление своего отзыва
function delReview(recipeId, reviewId) {
  if (!confirm("Удалить отзыв?")) return;

  db.collection("recipes").doc(recipeId).collection("reviews").doc(reviewId)
    .delete()
    .then(() => logAction(LOG_TYPES.REVIEW, "удалил свой отзыв", ""))
    .then(() => { loadMyReviews(); loadStats(); })
    .catch(e => alert(e.message));
}

// ===== История подборок (real-time: статус меняется на глазах) =====
function loadMyCollections() {
  db.collection("collections")
    .where("userId", "==", uid)
    .onSnapshot(snap => {
      if (snap.empty) {
        $("my-collections").innerHTML =
          `<p class="muted">Подборок пока нет. Сохраните рецепты в избранное и соберите первую.</p>`;
        return;
      }

      // сортируем на клиенте, чтобы не требовать составной индекс
      const docs = snap.docs.slice().sort((a, b) =>
        (b.data().createdAtMs || 0) - (a.data().createdAtMs || 0));

      $("my-collections").innerHTML = docs.map(d => {
        const c = d.data();
        const statusColor = c.status === "завершена" ? "#059669" : "#f59e0b";

        return `
          <div class="review">
            <div class="review-head">
              <b>${c.name}</b>
              <span class="badge" style="background:${statusColor};color:#fff">${c.status}</span>
              <span class="muted">${c.date || ""}</span>
            </div>
            <p class="muted">Рецептов: ${(c.recipeTitles || []).length}
               — ${(c.recipeTitles || []).join(", ")}</p>
            <button class="btn-red btn-sm" onclick="delCollection('${d.id}')">Удалить</button>
          </div>
        `;
      }).join("");
    }, e => {
      $("my-collections").innerHTML = `<p class="err">Ошибка: ${e.message}</p>`;
    });
}

function delCollection(id) {
  if (!confirm("Удалить подборку?")) return;
  db.collection("collections").doc(id).delete()
    .then(() => logAction(LOG_TYPES.COLLECTION, "удалил подборку", ""))
    .then(loadStats)
    .catch(e => alert(e.message));
}

// ===== История моих действий =====
let logsShown = 10;   // сколько записей показано

function loadMyLogs() {
  // Сортируем по числовому полю createdAtMs на клиенте —
  // так не нужен составной индекс userId + createdAt
  db.collection("logs").where("userId", "==", uid).get()
    .then(snap => {
      const docs = snap.docs.slice()
        .sort((a, b) => (b.data().createdAtMs || 0) - (a.data().createdAtMs || 0));

      $("my-logs").innerHTML = renderLogs(docs.slice(0, logsShown), false);
      $("btn-logs-more").classList.toggle("hidden", docs.length <= logsShown);

      $("btn-logs-more").onclick = () => {
        logsShown += 10;
        loadMyLogs();
      };
    })
    .catch(e => {
      $("my-logs").innerHTML = `<p class="err">Ошибка: ${e.message}</p>`;
    });
}

window.editReview = editReview;
window.delReview = delReview;
window.delCollection = delCollection;