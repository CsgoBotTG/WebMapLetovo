// Глобальные переменные: загруженные данные, карта Leaflet, текущий режим
var data = null;
var map = null;
var mode = "street";
var modeAttributionText = "";
var currentFloor = 1;
var currentIndoorBounds = null;
var searchInputTimer = null;

// Базовый URL каталога сайта (важно для GitHub Pages: /repo/ и для python -m http.server)
function getAppBaseUrl() {
  var path = window.location.pathname;
  var basePath;
  if (path.endsWith(".html")) {
    basePath = path.slice(0, path.lastIndexOf("/") + 1);
  } else if (path.endsWith("/")) {
    basePath = path;
  } else {
    basePath = path + "/";
  }
  return window.location.origin + basePath;
}

// Простая защита от вставки HTML во всплывающих текстах
function escapeHtml(text) {
  var div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function setModeButtons() {
  var btnStreet = document.getElementById("btnStreet");
  var btnInside = document.getElementById("btnInside");
  var floorControls = document.getElementById("floorControls");
  if (mode === "street") {
    btnStreet.classList.add("is-active");
    btnInside.classList.remove("is-active");
    btnStreet.setAttribute("aria-pressed", "true");
    btnInside.setAttribute("aria-pressed", "false");
    if (floorControls) {
      floorControls.hidden = true;
      floorControls.style.display = "none";
    }
  } else {
    btnInside.classList.add("is-active");
    btnStreet.classList.remove("is-active");
    btnInside.setAttribute("aria-pressed", "true");
    btnStreet.setAttribute("aria-pressed", "false");
    if (floorControls) {
      floorControls.hidden = false;
      floorControls.style.display = "flex";
    }
  }
}

function setFloorButtons() {
  var i;
  for (i = 1; i <= 4; i += 1) {
    var btn = document.getElementById("btnFloor" + i);
    if (!btn) {
      continue;
    }
    if (i === currentFloor) {
      btn.classList.add("is-active");
      btn.setAttribute("aria-pressed", "true");
    } else {
      btn.classList.remove("is-active");
      btn.setAttribute("aria-pressed", "false");
    }
  }
}

function removeMap() {
  if (map) {
    map.remove();
    map = null;
  }
}

// Запасная «картинка» прямо в коде — сработает, даже если PNG не найден
function streetFallbackImageUrl() {
  var svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">' +
    '<rect fill="#d9ead3" width="100%" height="100%"/>' +
    '<rect x="40" y="40" width="560" height="80" fill="#93c47d" rx="6"/>' +
    '<rect x="40" y="360" width="260" height="80" fill="#6aa84f" rx="6"/>' +
    '<rect x="340" y="200" width="260" height="160" fill="#4a86e8" rx="8" opacity="0.85"/>' +
    '<text x="32" y="28" fill="#1b4332" font-size="18" font-family="sans-serif">Заглушка (нет PNG)</text>' +
    "</svg>";
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function resolveUrlMaybeRelative(url) {
  if (!url || url.indexOf("data:") === 0 || /^https?:\/\//i.test(url)) {
    return url;
  }
  try {
    return new URL(url, getAppBaseUrl()).href;
  } catch (e) {
    return url;
  }
}

// Необязательно у точки: marker: { color / iconUrl / iconSize / iconAnchor / className }
function sanitizeMarkerColor(c) {
  if (typeof c !== "string") {
    return "#3388ff";
  }
  if (/^#[0-9A-Fa-f]{3}$/.test(c) || /^#[0-9A-Fa-f]{6}$/.test(c)) {
    return c;
  }
  return "#3388ff";
}

function markerIconOptions(cfg) {
  cfg = cfg || {};
  var iconUrl = cfg.iconUrl;
  var hasIcon = iconUrl && String(iconUrl).length > 0;
  if (hasIcon) {
    var w = 32;
    var h = 32;
    if (Array.isArray(cfg.iconSize) && cfg.iconSize.length >= 2) {
      w = Number(cfg.iconSize[0]) || 32;
      h = Number(cfg.iconSize[1]) || 32;
    }
    var ax = Math.floor(w / 2);
    var ay = h;
    if (Array.isArray(cfg.iconAnchor) && cfg.iconAnchor.length >= 2) {
      ax = Number(cfg.iconAnchor[0]);
      ay = Number(cfg.iconAnchor[1]);
    }
    return {
      icon: L.icon({
        iconUrl: resolveUrlMaybeRelative(String(iconUrl)),
        iconSize: [w, h],
        iconAnchor: [ax, ay],
      }),
    };
  }
  var colorStr =
    cfg.color && String(cfg.color).length > 0 ? String(cfg.color) : "#2563eb";
  var safeColor = sanitizeMarkerColor(colorStr);
  var sw = 12;
  var sh = 12;
  if (Array.isArray(cfg.iconSize) && cfg.iconSize.length >= 2) {
    sw = Number(cfg.iconSize[0]) || 12;
    sh = Number(cfg.iconSize[1]) || 12;
  }
  var sax = Math.floor(sw / 2);
  var say = Math.floor(sh / 2);
  if (Array.isArray(cfg.iconAnchor) && cfg.iconAnchor.length >= 2) {
    sax = Number(cfg.iconAnchor[0]);
    say = Number(cfg.iconAnchor[1]);
  }
  var extra = "";
  if (cfg.className && String(cfg.className).length > 0) {
    extra = " " + String(cfg.className).replace(/[^a-zA-Z0-9_\- ]/g, "");
  }
  return {
    icon: L.divIcon({
      className: "map-marker-div-wrap",
      html:
        '<div class="map-marker-dot-inner' +
        extra +
        '" style="background-color:' +
        safeColor +
        ';"></div>',
      iconSize: [sw, sh],
      iconAnchor: [sax, say],
    }),
  };
}

// Координаты в places: x/y в пикселях PNG (как в marker-tool: y сверху вниз).
// В Leaflet CRS.Simple верх плана = максимальный lat → lat = heightPx - y.
function indoorLatLngFromPixel(yPx, xPx, heightPx) {
  var h =
    typeof heightPx === "number" && heightPx > 0
      ? heightPx
      : data && data.inside && data.inside.bounds && data.inside.bounds[1]
        ? data.inside.bounds[1][0]
        : 1000;
  return [h - yPx, xPx];
}

function getIndoorPixelHeight() {
  if (
    currentIndoorBounds &&
    currentIndoorBounds[1] &&
    typeof currentIndoorBounds[1][0] === "number"
  ) {
    return currentIndoorBounds[1][0];
  }
  if (data && data.inside && data.inside.bounds && data.inside.bounds[1]) {
    return data.inside.bounds[1][0];
  }
  return 1000;
}

function attachMarkerLabel(marker, point) {
  if (!marker || !point) {
    return;
  }
  var raw = point.label;
  if (raw === undefined || raw === null) {
    return;
  }
  var s = String(raw).trim();
  if (!s) {
    return;
  }
  marker.bindTooltip(escapeHtml(s), {
    permanent: true,
    direction: "bottom",
    offset: [0, 6],
    opacity: 1,
    interactive: false,
    className: "marker-map-label",
  });
}

function addPlaceMarker(mapInstance, latlng, point, onClick) {
  var opts = markerIconOptions(point && point.marker ? point.marker : {});
  var marker = L.marker(latlng, opts);
  marker.addTo(mapInstance);
  attachMarkerLabel(marker, point);
  if (onClick) {
    marker.on("click", onClick);
  }
  return marker;
}

function fitStreet(mapInstance, boundsLatLng) {
  mapInstance.fitBounds(boundsLatLng, { padding: [24, 24], maxZoom: 19 });
}

// Убираем стандартную строку «Leaflet» в углу (ссылка на сайт библиотеки и её значок в браузере)
function hideLeafletCornerLink() {
  if (map && map.attributionControl && map.attributionControl.setPrefix) {
    map.attributionControl.setPrefix(false);
  }
}

// Показывает короткую подпись режима в правом нижнем углу
function setModeAttribution(text) {
  if (!map || !map.attributionControl) {
    return;
  }
  if (modeAttributionText) {
    map.attributionControl.removeAttribution(modeAttributionText);
  }
  modeAttributionText = text;
  map.attributionControl.addAttribution(modeAttributionText);
}

function showPlaceInfo(title, text) {
  var titleEl = document.getElementById("placeTitle");
  var textEl = document.getElementById("placeText");
  if (!titleEl || !textEl) {
    return;
  }
  titleEl.textContent = title;
  textEl.textContent = text || "";
}

function initStreetMap() {
  removeMap();
  var street = data.street;
  var c = street.center;
  var img = street.imageOverlay;
  map = L.map("map", { zoomSnap: 0.25, zoomControl: false });
  appendLeafletControls();
  hideLeafletCornerLink();
  setModeAttribution("Улица");
  showPlaceInfo("Улица", "");

  if (img && img.url && img.bounds && img.bounds.length === 2) {
    var bounds = L.latLngBounds(img.bounds[0], img.bounds[1]);
    // Подложка: если картинка не грузится, всё равно видно «территорию», а не пустой серый фон
    L.rectangle(bounds, {
      color: "#475569",
      weight: 2,
      fillColor: "#94a3b8",
      fillOpacity: 0.45,
    }).addTo(map);

    var imageUrl = resolveUrlMaybeRelative(img.url);
    var overlay = L.imageOverlay(imageUrl, bounds, { interactive: false }).addTo(map);

    overlay.on("load", function () {
      refreshMapSize();
      fitStreet(map, bounds);
    });

    fitStreet(map, bounds);

    // Если PNG не найден (404) или путь неверный — подменяем на встроенную SVG
    setTimeout(function () {
      var el = overlay.getElement && overlay.getElement();
      if (!el || el.tagName !== "IMG") {
        return;
      }
      if (el.complete && el.naturalWidth === 0) {
        swapStreetOverlay();
      }
      el.addEventListener("error", function onImgError() {
        el.removeEventListener("error", onImgError);
        swapStreetOverlay();
      });

      function swapStreetOverlay() {
        if (!map) {
          return;
        }
        if (map.hasLayer(overlay)) {
          map.removeLayer(overlay);
        }
        overlay = L.imageOverlay(streetFallbackImageUrl(), bounds, {
          interactive: false,
        }).addTo(map);
        refreshMapSize();
        fitStreet(map, bounds);
      }
    }, 0);
  } else {
    map.setView([c.lat, c.lng], c.zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
  }

  street.points.forEach(function (p) {
    addPlaceMarker(map, [p.lat, p.lng], p, function () {
      showPlaceInfo(p.title, p.text);
    });
  });

  // Несколько раз пересчитать размер — после показа скрытого блока это критично
  setTimeout(function () {
    refreshMapSize();
    if (img && img.bounds && img.bounds.length === 2) {
      fitStreet(map, L.latLngBounds(img.bounds[0], img.bounds[1]));
    } else {
      centerView();
    }
  }, 50);
  setTimeout(function () {
    refreshMapSize();
  }, 300);
}

function initIndoorMap(onReady) {
  removeMap();
  var inside = data.inside;
  var bounds = inside.bounds;
  currentIndoorBounds = bounds;

  var readyCallback = typeof onReady === "function" ? onReady : null;
  function fireReady() {
    if (readyCallback) {
      var cb = readyCallback;
      readyCallback = null;
      cb();
    }
  }

  map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: -3,
    maxZoom: 4,
    zoomSnap: 0.25,
    zoomControl: false,
  });
  appendLeafletControls();
  hideLeafletCornerLink();
  setModeAttribution("Внутри · Этаж " + currentFloor);
  setFloorButtons();
  showPlaceInfo("Этаж " + currentFloor, "");

  map.fitBounds(bounds);

  var bg = inside.background || { fill: "#dbeafe", stroke: "#93c5fd" };
  var floorImages = inside.floorImages || {};
  var floorImageUrl = floorImages[String(currentFloor)];
  var indoorBounds = L.latLngBounds(bounds[0], bounds[1]);
  var hasFloorImage = Boolean(floorImageUrl);

  // Сначала рисуем фон, чтобы даже при ошибке картинки режим внутри был виден.
  var indoorBg = L.rectangle(indoorBounds, {
    color: hasFloorImage ? "transparent" : bg.stroke,
    fillColor: bg.fill,
    // Если есть картинка этажа, фон и рамку скрываем.
    fillOpacity: hasFloorImage ? 0 : 1,
    weight: hasFloorImage ? 0 : 2,
  }).addTo(map);
  if (indoorBg.bringToBack) {
    indoorBg.bringToBack();
  }

  function addIndoorMarkers(heightPx) {
    inside.points.forEach(function (p) {
      if (typeof p.floor !== "number" || p.floor !== currentFloor) {
        return;
      }
      var y = typeof p.y === "number" ? p.y : 500;
      var x = typeof p.x === "number" ? p.x : 500;
      var ll = indoorLatLngFromPixel(y, x, heightPx);
      addPlaceMarker(map, ll, p, function () {
        showPlaceInfo(p.title, p.text);
      });
    });
  }

  if (hasFloorImage) {
    var resolvedFloorUrl = resolveUrlMaybeRelative(floorImageUrl);
    var cacheBreaker = resolvedFloorUrl.indexOf("?") >= 0 ? "&" : "?";
    resolvedFloorUrl = resolvedFloorUrl + cacheBreaker + "v=" + Date.now();
    var probe = new Image();
    probe.onload = function () {
      // Для CRS.Simple корректнее использовать реальные размеры изображения.
      var imgBounds = [
        [0, 0],
        [probe.naturalHeight, probe.naturalWidth],
      ];
      currentIndoorBounds = imgBounds;
      var floorOverlay = L.imageOverlay(resolvedFloorUrl, imgBounds, {
        interactive: false,
        opacity: 1,
      }).addTo(map);
      if (floorOverlay.bringToFront) {
        floorOverlay.bringToFront();
      }
      map.fitBounds(imgBounds);
      addIndoorMarkers(probe.naturalHeight);
      refreshMapSize();
      showPlaceInfo("Этаж " + currentFloor, "");
      fireReady();
    };
    probe.onerror = function () {
      // Не блокируем интерфейс: оставляем фон и даём понятную подсказку.
      showPlaceInfo(
        "Этаж " + currentFloor,
        "Картинка этажа не загрузилась. Проверьте путь: " + floorImageUrl
      );
      var nhFallback = bounds[1] && bounds[1][0] ? bounds[1][0] : 1000;
      addIndoorMarkers(nhFallback);
      fireReady();
    };
    probe.src = resolvedFloorUrl;
  } else {
    showPlaceInfo("Этаж " + currentFloor, "");
    var nhNoImg = bounds[1] && bounds[1][0] ? bounds[1][0] : 1000;
    addIndoorMarkers(nhNoImg);
    fireReady();
  }
}

function refreshMapSize() {
  if (map) {
    map.invalidateSize();
  }
}

function appendLeafletControls() {
  if (!map) {
    return;
  }
  var SearchControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function () {
      var wrap = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      var btn = L.DomUtil.create("button", "leaflet-control-search-btn", wrap);
      btn.type = "button";
      btn.title = "Поиск";
      btn.setAttribute("aria-label", "Поиск");
      btn.setAttribute("aria-expanded", "false");
      btn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.on(btn, "click", L.DomEvent.stopPropagation);
      L.DomEvent.on(btn, "click", function (e) {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        toggleSearchPanel(btn);
      });
      return wrap;
    },
  });
  new SearchControl().addTo(map);
  L.control.zoom({ position: "topleft" }).addTo(map);
}

function buildSearchIndex() {
  if (!data) {
    return [];
  }
  var list = [];
  (data.street.points || []).forEach(function (p) {
    list.push({
      scope: "street",
      title: p.title || "",
      text: p.text,
      lat: p.lat,
      lng: p.lng,
    });
  });
  (data.inside.points || []).forEach(function (p) {
    if (typeof p.floor !== "number") {
      return;
    }
    list.push({
      scope: "inside",
      title: p.title || "",
      text: p.text,
      x: p.x,
      y: p.y,
      floor: p.floor,
    });
  });
  return list;
}

function openSearchPanel(toolbarBtn) {
  var panel = document.getElementById("searchPanel");
  var input = document.getElementById("searchInput");
  if (!panel || !input) {
    return;
  }
  panel.hidden = false;
  var btns = toolbarBtn
    ? [toolbarBtn]
    : document.querySelectorAll(".leaflet-control-search-btn");
  Array.prototype.forEach.call(btns, function (b) {
    b.setAttribute("aria-expanded", "true");
  });
  input.focus();
  input.select();
}

function closeSearchPanel() {
  var panel = document.getElementById("searchPanel");
  var input = document.getElementById("searchInput");
  var ul = document.getElementById("searchResults");
  if (panel) {
    panel.hidden = true;
  }
  if (input) {
    input.value = "";
  }
  if (ul) {
    ul.hidden = true;
    ul.innerHTML = "";
  }
  var sb = document.querySelectorAll(".leaflet-control-search-btn");
  for (var si = 0; si < sb.length; si += 1) {
    sb[si].setAttribute("aria-expanded", "false");
  }
}

function toggleSearchPanel(toolbarBtn) {
  var panel = document.getElementById("searchPanel");
  if (!panel) {
    return;
  }
  if (panel.hidden) {
    openSearchPanel(toolbarBtn);
  } else {
    closeSearchPanel();
  }
}

function renderSearchResults(query) {
  var ul = document.getElementById("searchResults");
  if (!ul) {
    return;
  }
  var q = query.trim().toLowerCase();
  ul.innerHTML = "";
  if (q.length <= 3) {
    ul.hidden = true;
    return;
  }
  var items = buildSearchIndex();
  var matches = items.filter(function (it) {
    return (it.title || "").toLowerCase().indexOf(q) === 0;
  });
  if (matches.length === 0) {
    ul.hidden = true;
    return;
  }
  matches.slice(0, 20).forEach(function (it) {
    var li = document.createElement("li");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-result-btn";
    btn.textContent = it.title;
    var meta = document.createElement("span");
    meta.className = "search-result-meta";
    meta.textContent =
      it.scope === "street" ? "Улица" : "Внутри · этаж " + it.floor;
    btn.appendChild(meta);
    btn.addEventListener("click", function () {
      focusSearchItem(it);
    });
    li.appendChild(btn);
    ul.appendChild(li);
  });
  ul.hidden = false;
}

function panToInsideItem(item) {
  if (!map) {
    return;
  }
  var y = typeof item.y === "number" ? item.y : 500;
  var x = typeof item.x === "number" ? item.x : 500;
  var nh = getIndoorPixelHeight();
  var ll = indoorLatLngFromPixel(y, x, nh);
  map.setView(ll, Math.max(map.getZoom(), -0.5));
  showPlaceInfo(item.title, item.text || "");
}

function focusSearchItem(item) {
  closeSearchPanel();

  if (item.scope === "street") {
    var needStreet = mode !== "street";
    if (needStreet) {
      applyMode("street");
    }
    setTimeout(
      function () {
        if (!map) {
          return;
        }
        var z = map.getZoom();
        map.setView([item.lat, item.lng], Math.min(Math.max(z, 17), 19));
        showPlaceInfo(item.title, item.text || "");
      },
      needStreet ? 150 : 0
    );
    return;
  }

  var targetFloor = typeof item.floor === "number" ? item.floor : 1;
  if (mode === "inside" && currentFloor === targetFloor && map) {
    panToInsideItem(item);
    return;
  }
  currentFloor = targetFloor;
  setFloorButtons();
  if (mode !== "inside") {
    mode = "inside";
    setModeButtons();
  }
  initIndoorMap(function () {
    panToInsideItem(item);
  });
  requestAnimationFrame(function () {
    refreshMapSize();
  });
}

function applyMode(nextMode) {
  mode = nextMode;
  setModeButtons();
  if (mode === "street") {
    initStreetMap();
  } else {
    initIndoorMap();
  }
  requestAnimationFrame(function () {
    refreshMapSize();
    centerView();
  });
}

function centerView() {
  if (!map) {
    return;
  }
  if (mode === "street") {
    var street = data.street;
    var img = street.imageOverlay;
    if (img && img.bounds && img.bounds.length === 2) {
      map.fitBounds(img.bounds);
    } else {
      var c = street.center;
      map.setView([c.lat, c.lng], c.zoom);
    }
  } else {
    map.fitBounds(currentIndoorBounds || data.inside.bounds);
  }
}

function openApp() {
  var welcomeEl = document.getElementById("welcome");
  if (welcomeEl) {
    welcomeEl.hidden = true;
  }
  var appEl = document.getElementById("app");
  if (appEl) {
    appEl.hidden = false;
  }
  mode = "street";
  setModeButtons();

  // Пока блок был с атрибутом hidden, высота карты = 0. Ждём отрисовку, потом создаём карту.
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      initStreetMap();
      refreshMapSize();
      centerView();
      setTimeout(function () {
        refreshMapSize();
        centerView();
      }, 200);
    });
  });
}

function loadData() {
  var jsonUrl = getAppBaseUrl() + "places.json?v=" + Date.now();
  return fetch(jsonUrl, { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) {
        throw new Error("Не удалось загрузить places.json");
      }
      return res.json();
    })
    .then(function (json) {
      data = json;
      var welcomeTitle = document.getElementById("welcomeTitle");
      if (welcomeTitle) {
        welcomeTitle.textContent = data.schoolName;
      }
      var welcomeText = document.getElementById("welcomeText");
      if (welcomeText) {
        welcomeText.textContent = data.welcomeText;
      }
    });
}

var btnOpenMap = document.getElementById("btnOpenMap");
if (btnOpenMap) {
  btnOpenMap.addEventListener("click", function () {
    if (!data) {
      return;
    }
    openApp();
  });
}

var btnStreet = document.getElementById("btnStreet");
var btnInside = document.getElementById("btnInside");
var btnCenter = document.getElementById("btnCenter");
var floorButtons = [
  document.getElementById("btnFloor1"),
  document.getElementById("btnFloor2"),
  document.getElementById("btnFloor3"),
  document.getElementById("btnFloor4"),
];

if (btnStreet) {
  btnStreet.addEventListener("click", function () {
    if (!data || mode === "street") {
      return;
    }
    applyMode("street");
  });
}

if (btnInside) {
  btnInside.addEventListener("click", function () {
    if (!data || mode === "inside") {
      return;
    }
    applyMode("inside");
  });
}

if (btnCenter) {
  btnCenter.addEventListener("click", centerView);
}

floorButtons.forEach(function (btn, idx) {
  if (!btn) {
    return;
  }
  btn.addEventListener("click", function () {
    var nextFloor = idx + 1;
    if (currentFloor === nextFloor && mode === "inside") {
      return;
    }
    currentFloor = nextFloor;
    setFloorButtons();
    // Клик по этажу всегда открывает режим "Внутри" и нужный этаж.
    if (mode !== "inside") {
      applyMode("inside");
      return;
    }
    initIndoorMap();
    refreshMapSize();
    centerView();
  });
});

window.addEventListener("resize", function () {
  refreshMapSize();
});

(function initSearchUi() {
  var input = document.getElementById("searchInput");
  var closeBtn = document.getElementById("searchClose");
  if (input) {
    input.addEventListener("input", function () {
      if (searchInputTimer) {
        clearTimeout(searchInputTimer);
      }
      var v = input.value;
      searchInputTimer = setTimeout(function () {
        renderSearchResults(v);
      }, 120);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeSearchPanel();
      }
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      closeSearchPanel();
    });
  }
})();

loadData()
  .then(function () {
    if (!btnStreet || !btnInside || !btnCenter) {
      throw new Error("Не найдены кнопки управления картой в index.html");
    }
    setFloorButtons();
    openApp();
  })
  .catch(function (err) {
    var welcomeText = document.getElementById("welcomeText");
    if (welcomeText) {
      welcomeText.textContent =
        "Ошибка: откройте сайт через локальный сервер (не файл с диска). " +
        String(err.message);
    }
    if (btnOpenMap) {
      btnOpenMap.disabled = true;
    }
  });
