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

// id рецепта берём из адреса: rec.html?id=XXXX
const recipeId = new URLSearchParams(location.search).get("id");

let profile = null;
let recipe = null;
let isFav = false;
let simLast = null;      // курсор пагинации похожих
const SIM_PAGE = 3;

if (!recipeId) {
  $("recipe-state").textContent = "Рецепт не выбран. Вернитесь в каталог.";
}

// ===== Загрузка рецепта =====
function loadRecipe() {
  db.collection("recipes").doc(recipeId).get().then(doc => {
    if (!doc.exists) {
      $("recipe-state").textContent = "Рецепт не найден.";
      return;
    }

    recipe = { id: doc.id, ...doc.data() };
    document.title = recipe.title + " — Книга рецептов";

    // Фото рецепта, если админ указал ссылку
    if (recipe.imageURL) {
      $("r-photo").src = recipe.imageURL;
      $("r-photo").alt = recipe.title;
      $("r-photo").classList.remove("hidden");
    }

    $("r-icon").textContent = CATS[recipe.category] || "🍽";
    $("r-title").textContent = recipe.title;
    $("r-desc").textContent = recipe.description || "";
    $("r-cat").textContent = recipe.category || "—";
    $("r-time").textContent = recipe.cookTime || "?";
    $("r-author").textContent = recipe.authorName || "—";
    $("r-rating").textContent = (recipe.rating || 0).toFixed(1);
    $("r-count").textContent = recipe.ratingsCount || 0;

    // Ингредиенты
    const ings = recipe.ingredients && recipe.ingredients.length
      ? recipe.ingredients
      : ["Ингредиенты пока не заполнены"];
    $("r-ingredients").innerHTML = ings.map(i => `<li>${i}</li>`).join("");

    // Шаги
    const steps = recipe.steps && recipe.steps.length
      ? recipe.steps
      : ["Шаги приготовления пока не заполнены"];
    $("r-steps").innerHTML = steps.map(s => `<li>${s}</li>`).join("");

    $("recipe-state").classList.add("hidden");
    $("recipe-content").classList.remove("hidden");

    loadSimilar();
  }).catch(e => {
    $("recipe-state").textContent = "Ошибка: " + e.message;
  });
}

// ===== Авторизация =====
auth.onAuthStateChanged(user => {
  if (user) {
    $("guest").classList.add("hidden");
    $("logged").classList.remove("hidden");
    $("review-form").classList.remove("hidden");
    $("review-login-hint").classList.add("hidden");

    db.collection("users").doc(user.uid).get().then(doc => {
      profile = doc.data() || {};
      $("user-name").textContent = profile.name || user.email;
    });

    checkFavorite();
  } else {
    $("guest").classList.remove("hidden");
    $("logged").classList.add("hidden");
    $("review-form").classList.add("hidden");
    $("review-login-hint").classList.remove("hidden");
    profile = null;
    isFav = false;
    updateFavButton();
  }

  loadReviews();
});

$("btn-logout").onclick = () => auth.signOut();

// ===== Избранное =====
function checkFavorite() {
  const uid = auth.currentUser.uid;
  db.collection("favorites").doc(uid + "_" + recipeId).get()
    .then(doc => { isFav = doc.exists; updateFavButton(); });
}

function updateFavButton() {
  $("btn-fav").textContent = isFav ? "★ В избранном" : "☆ Сохранить рецепт";
}

$("btn-fav").onclick = () => {
  const user = auth.currentUser;
  if (!user) { alert("Войдите, чтобы сохранять рецепты"); return; }

  const favDoc = db.collection("favorites").doc(user.uid + "_" + recipeId);

  if (isFav) {
    favDoc.delete().then(() => {
      isFav = false;
      updateFavButton();
      logAction(LOG_TYPES.FAVORITE, "убрал из избранного", recipe.title);
    });
  } else {
    favDoc.set({
      userId: user.uid,
      recipeId: recipeId,
      title: recipe.title,
      date: new Date().toLocaleDateString("ru-RU"),
      addedAt: new Date()
    }).then(() => {
      isFav = true;
      updateFavButton();
      logAction(LOG_TYPES.FAVORITE, "сохранил в избранное", recipe.title);
    });
  }
};

// ===== Отзывы (real-time) =====
function loadReviews() {
  db.collection("recipes").doc(recipeId).collection("reviews")
    .orderBy("createdAt", "desc")
    .onSnapshot(snap => {
      if (snap.empty) {
        $("reviews-list").innerHTML = `<p class="muted">Отзывов пока нет. Будьте первым!</p>`;
        return;
      }

      const uid = auth.currentUser ? auth.currentUser.uid : null;

      $("reviews-list").innerHTML = snap.docs.map(d => {
        const r = d.data();
        const stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
        const own = uid && r.userId === uid;
        const isAdmin = profile && profile.role === "admin";

        return `
          <div class="review">
            <div class="review-head">
              <b>${r.userName || "Пользователь"}</b>
              <span class="stars">${stars}</span>
              <span class="muted">${r.date || ""}</span>
            </div>
            <p>${r.text}</p>
            ${(own || isAdmin)
              ? `<button class="btn-red btn-sm" onclick="delReview('${d.id}')">Удалить</button>`
              : ""}
          </div>
        `;
      }).join("");

      updateRating(snap.docs.map(d => d.data().rating));
    }, e => {
      $("reviews-list").innerHTML = `<p class="err">Ошибка загрузки отзывов: ${e.message}</p>`;
    });
}

// Пересчёт среднего рейтинга и запись в документ рецепта
// (дублирование данных для производительности — требование ТЗ)
function updateRating(ratings) {
  if (!ratings.length) return;
  const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;

  $("r-rating").textContent = avg.toFixed(1);
  $("r-count").textContent = ratings.length;

  db.collection("recipes").doc(recipeId).update({
    rating: Math.round(avg * 10) / 10,
    ratingsCount: ratings.length
  }).catch(() => {}); // у обычного пользователя может не быть прав — не критично
}

$("btn-review").onclick = () => {
  $("rev-err").textContent = "";
  const user = auth.currentUser;
  if (!user) return;

  const text = $("rev-text").value.trim();
  if (!text) { $("rev-err").textContent = "Введите текст отзыва"; return; }

  db.collection("recipes").doc(recipeId).collection("reviews").add({
    userId: user.uid,
    userName: (profile && profile.name) || user.email,
    text: text,
    rating: Number($("rev-rating").value),
    date: new Date().toLocaleDateString("ru-RU"),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => {
    logAction(LOG_TYPES.REVIEW, "оставил отзыв на рецепт", recipe.title);
    $("rev-text").value = "";
  }).catch(e => $("rev-err").textContent = e.message);
};

function delReview(id) {
  if (!confirm("Удалить отзыв?")) return;
  db.collection("recipes").doc(recipeId).collection("reviews").doc(id).delete()
    .then(() => logAction(LOG_TYPES.REVIEW, "удалил отзыв на рецепте", recipe.title))
    .catch(e => alert(e.message));
}

// ===== Похожие рецепты (та же категория) с пагинацией =====
function similarQuery(cursor) {
  let q = db.collection("recipes")
    .where("category", "==", recipe.category)
    .orderBy("createdAt", "desc");

  if (cursor) q = q.startAfter(cursor);
  return q.limit(SIM_PAGE);
}

function renderSimilar(docs, append) {
  const html = docs
    .filter(d => d.id !== recipeId)   // сам рецепт не показываем
    .map(d => {
      const r = d.data();
      const img = r.imageURL
        ? `<img src="${r.imageURL.replace(/"/g, "")}" alt="" loading="lazy">`
        : (CATS[r.category] || "🍽");

      return `
        <a class="card" href="rec.html?id=${d.id}">
          <div class="card-img">
            ${img}
            <span class="time-pill">⏱ ${r.cookTime} мин</span>
          </div>
          <div class="card-body">
            <h3>${r.title}</h3>
            <p>${r.description || ""}</p>
          </div>
        </a>
      `;
    }).join("");

  if (append) $("similar-grid").innerHTML += html;
  else $("similar-grid").innerHTML = html;

  const empty = !$("similar-grid").innerHTML.trim();
  $("similar-state").textContent = empty ? "Похожих рецептов нет." : "";
  $("similar-state").classList.toggle("hidden", !empty);
}

function loadSimilar() {
  similarQuery().get().then(snap => {
    simLast = snap.docs[snap.docs.length - 1];
    renderSimilar(snap.docs, false);
    $("btn-similar-more").classList.toggle("hidden", snap.size < SIM_PAGE);
  }).catch(e => {
    $("similar-state").textContent = "Ошибка: " + e.message;
  });
}

$("btn-similar-more").onclick = () => {
  if (!simLast) return;
  similarQuery(simLast).get().then(snap => {
    simLast = snap.docs[snap.docs.length - 1] || simLast;
    renderSimilar(snap.docs, true);
    if (snap.size < SIM_PAGE) $("btn-similar-more").classList.add("hidden");
  });
};

if (recipeId) loadRecipe();