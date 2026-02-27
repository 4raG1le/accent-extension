let selectionMode = false;
let selectedElement = null;
let selectedRange = null;
let wordsWithStress = [];
let isInitialized = false;

// Функция инициализации
function initializeExtension() {
  if (isInitialized) return;
  
  console.log('Инициализация расширения "Ударение в словах"');
  
  chrome.storage.local.get(['stressedWords'], function(result) {
    if (result.stressedWords && result.stressedWords.length > 0) {
      wordsWithStress = result.stressedWords;
      console.log('Загружены слова с ударениями:', wordsWithStress);
      applyStresses();
    }
    isInitialized = true;
  });
}

// Запускаем инициализацию
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
  initializeExtension();
}

// Слушаем изменения в storage
chrome.storage.onChanged.addListener(function(changes, namespace) {
  if (namespace === 'local' && changes.stressedWords) {
    wordsWithStress = changes.stressedWords.newValue || [];
    console.log('Обновлены слова с ударениями из storage:', wordsWithStress);
    applyStresses();
  }
});

// Слушаем сообщения от popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  console.log('Получено сообщение:', request);
  
  if (request.action === 'startSelection') {
    selectionMode = true;
    selectedElement = null;
    selectedRange = null;
    document.body.style.cursor = 'crosshair';
    showNotification('Кликните на слово для добавления ударения');
    sendResponse({status: 'started'});
  } else if (request.action === 'cancelSelection') {
    selectionMode = false;
    document.body.style.cursor = 'default';
    sendResponse({status: 'cancelled'});
  } else if (request.action === 'updateStresses') {
    wordsWithStress = request.words;
    console.log('Обновлены слова из popup:', wordsWithStress);
    applyStresses();
    sendResponse({status: 'updated'});
  } else if (request.action === 'highlightWord') {
    if (request.wordId) {
      highlightWordById(request.wordId);
    }
    sendResponse({status: 'highlighted'});
  }
  return true;
});

// Наблюдаем за изменениями в DOM
let observer = null;

function observeDOMChanges() {
  if (observer) {
    observer.disconnect();
  }
  
  observer = new MutationObserver(function(mutations) {
    let shouldReapply = false;
    
    mutations.forEach(function(mutation) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        shouldReapply = true;
      }
    });
    
    if (shouldReapply && wordsWithStress.length > 0) {
      clearTimeout(window.reapplyTimeout);
      window.reapplyTimeout = setTimeout(function() {
        console.log('Обнаружены изменения в DOM, применяем ударения');
        applyStresses();
      }, 500);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

if (document.readyState === 'complete') {
  observeDOMChanges();
} else {
  window.addEventListener('load', observeDOMChanges);
}

// Обработка видимости страницы
document.addEventListener('visibilitychange', function() {
  if (!document.hidden && wordsWithStress.length > 0) {
    console.log('Вкладка стала видимой, применяем ударения');
    applyStresses();
  }
});

// Обработка кликов для выбора слова
document.addEventListener('click', function(e) {
  // Если клик по модальному окну - игнорируем
  if (e.target.closest('#stress-modal') || e.target.closest('#modal-overlay')) {
    return;
  }
  
  if (!selectionMode) return;
  
  e.preventDefault();
  e.stopPropagation();

  // Получаем информацию о слове под курсором
  const wordInfo = getWordAtPoint(e.clientX, e.clientY);
  
  if (wordInfo && wordInfo.word) {
    selectedElement = wordInfo.node;
    selectedRange = {
      start: wordInfo.start,
      end: wordInfo.end,
      text: wordInfo.text
    };
    
    // Временно отключаем режим выбора
    selectionMode = false;
    document.body.style.cursor = 'default';
    
    // Показываем диалог выбора ударения
    showStressSelection(wordInfo.word, wordInfo);
  } else {
    showNotification('Не удалось определить слово');
  }
}, true);

// Функция для получения слова по координатам
function getWordAtPoint(x, y) {
  const range = document.caretRangeFromPoint(x, y);
  if (!range) return null;
  
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  
  const text = node.textContent;
  const offset = range.startOffset;
  
  // Находим границы слова
  let start = offset;
  let end = offset;
  
  // Ищем начало слова (двигаемся влево до разделителя)
  while (start > 0 && !isWordBoundary(text[start - 1])) {
    start--;
  }
  
  // Ищем конец слова (двигаемся вправо до разделителя)
  while (end < text.length && !isWordBoundary(text[end])) {
    end++;
  }
  
  const word = text.substring(start, end).trim();
  
  if (!word || word.length === 0) return null;
  
  return {
    word: word,
    node: node,
    start: start,
    end: end,
    text: text,
    element: node.parentElement
  };
}

// Проверка границы слова
function isWordBoundary(char) {
  return char.match(/[\s.,!?;:()\[\]{}<>\/\\\-="'«»]/) !== null;
}

// Показываем диалог выбора ударения
function showStressSelection(word, wordInfo) {
  // Находим все гласные в слове
  const vowels = [];
  for (let i = 0; i < word.length; i++) {
    if ('аеёиоуыэюяАЕЁИОУЫЭЮЯ'.includes(word[i])) {
      vowels.push({
        index: i,
        letter: word[i]
      });
    }
  }
  
  if (vowels.length === 0) {
    alert('В слове нет гласных букв');
    selectionMode = true;
    document.body.style.cursor = 'crosshair';
    return;
  }
  
  // Удаляем предыдущее модальное окно
  removeExistingModal();
  
  // Создаем затемнение
  const overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 10000;
  `;
  document.body.appendChild(overlay);

  // Создаем модальное окно
  const modal = document.createElement('div');
  modal.id = 'stress-modal';
  modal.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    padding: 25px;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 10001;
    text-align: center;
    max-width: 450px;
    border: 1px solid #ddd;
  `;

  let html = '<h3 style="margin:0 0 15px 0; color:#333;">Выберите ударную гласную:</h3>';
  html += '<div style="font-size:20px; margin-bottom:20px; padding:10px; background:#f5f5f5; border-radius:8px;">"' + word + '"</div>';
  html += '<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-bottom:20px;">';
  
  vowels.forEach(v => {
    const before = word.substring(0, v.index);
    const after = word.substring(v.index + 1);
    const stressedChar = word[v.index] + '\u0301';
    const stressedWord = before + stressedChar + after;
    
    html += `<button class="stress-btn" 
      data-word="${word}" 
      data-index="${v.index}"
      data-stressed="${stressedWord}"
      style="margin: 2px; padding: 12px 18px; background-color: #4CAF50; color: white; border: none; border-radius: 6px; cursor: pointer; font-size:18px; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">
      ${stressedWord}
    </button>`;
  });
  
  html += '</div>';
  html += '<button id="cancel-stress" style="padding: 10px 25px; background-color: #f44336; color: white; border: none; border-radius: 6px; cursor: pointer; font-size:14px;">Отмена</button>';
  
  modal.innerHTML = html;
  document.body.appendChild(modal);

  // Обработка кнопок с ударением
  modal.querySelectorAll('.stress-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      const originalWord = this.dataset.word;
      const stressedWord = this.dataset.stressed;
      const accentIndex = parseInt(this.dataset.index);
      
      // Сохраняем для конкретного слова на странице
      saveSpecificWordStress(originalWord, stressedWord, accentIndex, wordInfo);
      
      closeModal();
    });
  });

  // Кнопка отмены
  document.getElementById('cancel-stress').addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    closeModal(true); // Возвращаем режим выбора
  });

  // Закрытие по клику на оверлей
  overlay.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    closeModal(true); // Возвращаем режим выбора
  });

  // Закрытие по Escape
  function onEscape(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeModal(true); // Возвращаем режим выбора
      document.removeEventListener('keydown', onEscape);
    }
  }
  document.addEventListener('keydown', onEscape);
}

// Функция закрытия модального окна
function closeModal(restoreSelectionMode = false) {
  removeExistingModal();
  
  if (restoreSelectionMode) {
    selectionMode = true;
    document.body.style.cursor = 'crosshair';
  } else {
    selectionMode = false;
    document.body.style.cursor = 'default';
  }
}

// Удаление модального окна
function removeExistingModal() {
  const modal = document.getElementById('stress-modal');
  const overlay = document.getElementById('modal-overlay');
  
  if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
}

// Сохранение ударения для конкретного слова
function saveSpecificWordStress(original, stressed, accentIndex, wordInfo) {
  // Создаем уникальный идентификатор для этого конкретного слова
  const path = getUniquePath(wordInfo.node, wordInfo.start);
  
  const wordObj = {
    id: generateId(),
    original: original,
    stressed: stressed,
    accentIndex: accentIndex,
    path: path,
    startOffset: wordInfo.start,
    endOffset: wordInfo.end,
    pageUrl: window.location.href,
    pageTitle: document.title,
    timestamp: Date.now()
  };
  
  chrome.storage.local.get(['stressedWords'], function(result) {
    let words = result.stressedWords || [];
    
    // Удаляем старую запись для этого же конкретного слова
    words = words.filter(w => !(w.path === path && w.original === original));
    
    words.push(wordObj);
    
    chrome.storage.local.set({stressedWords: words}, function() {
      wordsWithStress = words;
      
      // Применяем ударение к текущему слову
      applyStressToWord(wordInfo, accentIndex, wordObj.id);
      
      showNotification('Ударение сохранено для этого слова');
      
      chrome.runtime.sendMessage({
        action: 'stressSaved', 
        word: stressed,
        wordId: wordObj.id
      });
    });
  });
}

// Получение уникального пути к текстовому узлу
function getUniquePath(node, offset) {
  if (!node) return '';
  
  // Поднимаемся до элемента
  while (node && node.nodeType === Node.TEXT_NODE) {
    node = node.parentNode;
  }
  
  if (!node) return '';
  
  // Строим CSS-селектор
  const path = [];
  while (node && node !== document.body) {
    let selector = node.tagName.toLowerCase();
    
    if (node.id) {
      selector += '#' + node.id;
      path.unshift(selector);
      break;
    } else {
      if (node.className) {
        const classes = node.className.split(' ').filter(c => c.trim());
        if (classes.length) {
          selector += '.' + classes.join('.');
        }
      }
      
      // Добавляем индекс среди соседей
      const siblings = Array.from(node.parentNode.children);
      const index = siblings.indexOf(node);
      selector += `:nth-child(${index + 1})`;
      
      path.unshift(selector);
      node = node.parentNode;
    }
  }
  
  return path.join(' > ') + `::text[${offset}]`;
}

// Применение ударения к конкретному слову
function applyStressToWord(wordInfo, accentIndex, wordId) {
  const { node, start, end, text } = wordInfo;
  const word = text.substring(start, end);
  
  // Создаем новое слово с ударением
  const stressedWord = word.substring(0, accentIndex) + 
                      word[accentIndex] + '\u0301' + 
                      word.substring(accentIndex + 1);
  
  // Разбиваем текст на части
  const beforeWord = text.substring(0, start);
  const afterWord = text.substring(end);
  
  // Создаем новый текстовый узел для части до слова
  if (beforeWord) {
    const beforeNode = document.createTextNode(beforeWord);
    node.parentNode.insertBefore(beforeNode, node);
  }
  
  // Создаем span с ударным словом
  const span = document.createElement('span');
  span.className = 'stressed-word';
  span.setAttribute('data-word-id', wordId);
  span.setAttribute('data-original', word);
  span.setAttribute('data-stressed', stressedWord);
  span.setAttribute('title', `Ударение: ${stressedWord}`);
  span.textContent = stressedWord;
  
  // Копируем стили от родителя
  copyStyles(node.parentElement, span);
  
  node.parentNode.insertBefore(span, node);
  
  // Создаем новый текстовый узел для части после слова
  if (afterWord) {
    const afterNode = document.createTextNode(afterWord);
    node.parentNode.insertBefore(afterNode, node);
  }
  
  // Удаляем оригинальный текстовый узел
  node.remove();
}

// Копирование стилей
function copyStyles(source, target) {
  if (!source) return;
  
  const styles = window.getComputedStyle(source);
  const importantProps = [
    'font-family', 'font-size', 'font-weight', 'font-style',
    'color', 'background-color', 'line-height', 'letter-spacing',
    'text-transform', 'text-decoration'
  ];
  
  importantProps.forEach(prop => {
    target.style[prop] = styles.getPropertyValue(prop);
  });
}

// Применение всех сохраненных ударений
function applyStresses() {
  if (!wordsWithStress || wordsWithStress.length === 0) return;

  console.log('Применяем ударения к странице');
  
  const currentUrl = window.location.href;
  const pageWords = wordsWithStress.filter(w => w.pageUrl === currentUrl);
  
  if (pageWords.length === 0) return;
  
  // Проходим по всем сохраненным словам для этой страницы
  pageWords.forEach(wordObj => {
    try {
      // Ищем элемент по пути
      const element = findElementByPath(wordObj.path);
      if (!element) return;
      
      // В элементе ищем текстовый узел с нужным смещением
      const textNodes = [];
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function(node) {
            if (node.parentElement && node.parentElement.classList.contains('stressed-word')) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );
      
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }
      
      textNodes.forEach(node => {
        const text = node.textContent;
        
        // Проверяем, содержит ли узел наше слово примерно в нужной позиции
        if (text.includes(wordObj.original)) {
          const index = text.indexOf(wordObj.original);
          
          // Если позиция примерно совпадает
          if (Math.abs(index - wordObj.startOffset) < 5) {
            applyStressToNode(node, wordObj);
          }
        }
      });
    } catch (e) {
      console.log('Ошибка при применении ударения:', e);
    }
  });
  
  addStressStyles();
}

// Применение ударения к найденному узлу
function applyStressToNode(node, wordObj) {
  const text = node.textContent;
  const word = wordObj.original;
  const stressedWord = wordObj.stressed;
  const index = text.indexOf(word);
  
  if (index === -1) return;
  
  // Разбиваем текст
  const beforeWord = text.substring(0, index);
  const afterWord = text.substring(index + word.length);
  
  // Создаем новый текстовый узел для части до слова
  if (beforeWord) {
    const beforeNode = document.createTextNode(beforeWord);
    node.parentNode.insertBefore(beforeNode, node);
  }
  
  // Создаем span с ударным словом
  const span = document.createElement('span');
  span.className = 'stressed-word';
  span.setAttribute('data-word-id', wordObj.id);
  span.setAttribute('data-original', word);
  span.setAttribute('data-stressed', stressedWord);
  span.setAttribute('title', `Ударение: ${stressedWord}`);
  span.textContent = stressedWord;
  
  // Копируем стили
  copyStyles(node.parentElement, span);
  
  node.parentNode.insertBefore(span, node);
  
  // Создаем новый текстовый узел для части после слова
  if (afterWord) {
    const afterNode = document.createTextNode(afterWord);
    node.parentNode.insertBefore(afterNode, node);
  }
  
  // Удаляем оригинальный узел
  node.remove();
}

// Поиск элемента по пути
function findElementByPath(path) {
  try {
    if (!path) return null;
    
    // Убираем часть с ::text
    const elementPath = path.split('::')[0];
    return document.querySelector(elementPath);
  } catch (e) {
    return null;
  }
}

// Генерация ID
function generateId() {
  return 'word_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Добавление стилей
function addStressStyles() {
  if (document.getElementById('stress-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'stress-styles';
  style.textContent = `
    .stressed-word {
      cursor: help;
      border-bottom: 2px dotted #4CAF50;
      background-color: rgba(76, 175, 80, 0.1);
      transition: all 0.3s ease;
      display: inline;
    }
    
    .stressed-word:hover {
      background-color: rgba(76, 175, 80, 0.3);
      border-bottom-width: 3px;
    }
    
    .stressed-word.highlight {
      background-color: rgba(255, 193, 7, 0.5);
      border-bottom-color: #FFC107;
      animation: pulse 0.5s ease-in-out;
    }
    
    @keyframes pulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.05); }
      100% { transform: scale(1); }
    }
  `;
  document.head.appendChild(style);
}

// Подсветка слова по ID
function highlightWordById(wordId) {
  const elements = document.querySelectorAll(`[data-word-id="${wordId}"]`);
  
  if (elements.length > 0) {
    elements.forEach(el => {
      el.classList.add('highlight');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      setTimeout(() => {
        el.classList.remove('highlight');
      }, 2000);
    });
  } else {
    showNotification('Слово не найдено на странице');
  }
}

// Показ уведомлений
function showNotification(message) {
  const oldNotification = document.getElementById('stress-notification');
  if (oldNotification) {
    oldNotification.remove();
  }
  
  const notification = document.createElement('div');
  notification.id = 'stress-notification';
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #333;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    z-index: 10002;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: slideIn 0.3s, fadeOut 0.3s 2.7s forwards;
    max-width: 350px;
    word-wrap: break-word;
    border-left: 4px solid #4CAF50;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 3000);
}

// Добавляем стили для анимаций
if (!document.getElementById('animation-styles')) {
  const style = document.createElement('style');
  style.id = 'animation-styles';
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes fadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}