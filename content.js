let selectionMode = false;
let selectedPhrase = '';
let selectedWord = '';
let wordsWithStress = [];
let isInitialized = false;

// Функция инициализации - загружает сохраненные слова и применяет их
function initializeExtension() {
  if (isInitialized) return;
  
  console.log('Инициализация расширения "Ударение в словах"');
  
  chrome.storage.local.get(['stressedWords'], function(result) {
    if (result.stressedWords && result.stressedWords.length > 0) {
      wordsWithStress = result.stressedWords;
      console.log('Загружены слова с ударениями:', wordsWithStress);
      applyStresses();
    } else {
      console.log('Нет сохраненных слов с ударениями');
    }
    isInitialized = true;
  });
}

// Запускаем инициализацию сразу при загрузке скрипта
initializeExtension();

// Также запускаем инициализацию после полной загрузки DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
  initializeExtension();
}

// Слушаем изменения в storage (для обновления при изменении из другого окна)
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
    selectedPhrase = '';
    selectedWord = '';
    document.body.style.cursor = 'crosshair';
    showNotification('Выберите фразу, затем слово и ударение');
    sendResponse({status: 'started'});
  } else if (request.action === 'cancelSelection') {
    selectionMode = false;
    document.body.style.cursor = 'default';
    hideSelectionOverlay();
    sendResponse({status: 'cancelled'});
  } else if (request.action === 'updateStresses') {
    wordsWithStress = request.words;
    console.log('Обновлены слова из popup:', wordsWithStress);
    applyStresses();
    sendResponse({status: 'updated'});
  } else if (request.action === 'highlightWord') {
    highlightWord(request.word);
    sendResponse({status: 'highlighted'});
  } else if (request.action === 'getStatus') {
    sendResponse({
      initialized: isInitialized,
      wordsCount: wordsWithStress.length,
      words: wordsWithStress
    });
  }
  return true;
});

// Слушаем события навигации (для SPA и динамических сайтов)
let observer = null;

// Наблюдаем за изменениями в DOM (для динамически загружаемого контента)
function observeDOMChanges() {
  if (observer) {
    observer.disconnect();
  }
  
  observer = new MutationObserver(function(mutations) {
    // Проверяем, были ли значительные изменения в DOM
    let shouldReapply = false;
    
    mutations.forEach(function(mutation) {
      // Если добавлены новые узлы или изменен текст
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        shouldReapply = true;
      } else if (mutation.type === 'characterData') {
        shouldReapply = true;
      }
    });
    
    if (shouldReapply && wordsWithStress.length > 0) {
      // Используем debounce для избежания частых вызовов
      clearTimeout(window.reapplyTimeout);
      window.reapplyTimeout = setTimeout(function() {
        console.log('Обнаружены изменения в DOM, применяем ударения');
        applyStresses();
      }, 500);
    }
  });
  
  // Наблюдаем за всем документом
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

// Запускаем наблюдение после загрузки страницы
if (document.readyState === 'complete') {
  observeDOMChanges();
} else {
  window.addEventListener('load', observeDOMChanges);
}

// Обработка видимости страницы (когда пользователь возвращается на вкладку)
document.addEventListener('visibilitychange', function() {
  if (!document.hidden && wordsWithStress.length > 0) {
    console.log('Вкладка стала видимой, применяем ударения');
    applyStresses();
  }
});

// Обработка кликов
document.addEventListener('click', function(e) {
  if (!selectionMode) return;
  
  // Проверяем, не кликнули ли по модальному окну
  if (e.target.closest('#stress-modal') || e.target.closest('.stress-btn')) {
    return;
  }
  
  e.preventDefault();
  e.stopPropagation();

  if (!selectedPhrase) {
    // Первый клик - выбор фразы
    selectedPhrase = getPhraseFromClick(e);
    if (selectedPhrase) {
      highlightPhrase(selectedPhrase);
      showNotification('Теперь выберите слово в фразе');
    } else {
      showNotification('Не удалось определить фразу. Попробуйте еще раз.');
    }
  } else if (!selectedWord) {
    // Второй клик - выбор слова
    selectedWord = getWordFromClick(e, selectedPhrase);
    if (selectedWord) {
      showStressSelection(selectedWord);
    } else {
      showNotification('Выберите слово из выделенной фразы');
    }
  }
}, true);

function getPhraseFromClick(e) {
  const range = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (!range) return '';
  
  const node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    // Находим границы слова
    let start = range.startOffset;
    let end = range.startOffset;
    
    // Ищем начало слова
    while (start > 0 && !text[start - 1].match(/\s/)) {
      start--;
    }
    
    // Ищем конец слова
    while (end < text.length && !text[end].match(/\s/)) {
      end++;
    }
    
    return text.substring(start, end);
  }
  return '';
}

function getWordFromClick(e, phrase) {
  const range = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (!range) return '';
  
  const node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    
    // Находим границы слова под курсором
    let start = range.startOffset;
    let end = range.startOffset;
    
    while (start > 0 && !text[start - 1].match(/\s/)) {
      start--;
    }
    
    while (end < text.length && !text[end].match(/\s/)) {
      end++;
    }
    
    const clickedWord = text.substring(start, end);
    
    // Проверяем, что слово совпадает с выбранной фразой
    if (clickedWord.toLowerCase() === phrase.toLowerCase()) {
      return clickedWord;
    }
  }
  return '';
}

function highlightPhrase(phrase) {
  // Убираем предыдущее выделение
  hideSelectionOverlay();
  
  // Создаем overlay для выделения фразы
  const overlay = document.createElement('div');
  overlay.id = 'phrase-highlight';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(255, 255, 0, 0.2);
    pointer-events: none;
    z-index: 10000;
  `;
  document.body.appendChild(overlay);
  
  // Показываем выбранную фразу
  showNotification('Выбрана фраза: "' + phrase + '"');
}

function showStressSelection(word) {
  // Создаем модальное окно для выбора ударения
  const modal = document.createElement('div');
  modal.id = 'stress-modal';
  modal.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    z-index: 10001;
    text-align: center;
    max-width: 400px;
  `;

  const letters = word.split('');
  let html = '<h3 style="margin-top:0;">Выберите ударную гласную в слове:</h3>';
  html += '<p style="font-size:18px; margin-bottom:15px; color:#333;">"' + word + '"</p>';
  html += '<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-bottom:15px;">';
  
  // Создаем кнопки для каждой гласной
  letters.forEach((letter, index) => {
    if ('аеёиоуыэюяАЕЁИОУЫЭЮЯ'.includes(letter)) {
      const stressedWord = word.substring(0, index) + '\u0301' + word.substring(index);
      html += `<button class="stress-btn" data-stressed="${stressedWord}" data-index="${index}" style="margin: 2px; padding: 10px 15px; background-color: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size:16px;">${stressedWord}</button>`;
    }
  });
  
  html += '</div>';
  html += '<button id="cancel-stress" style="padding: 8px 20px; background-color: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-size:14px;">Отмена</button>';
  
  modal.innerHTML = html;
  document.body.appendChild(modal);

  // Добавляем затемнение фона
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

  // Обработчики для кнопок - используем захват события, чтобы предотвратить всплытие
  modal.querySelectorAll('.stress-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      const stressedWord = this.dataset.stressed;
      saveWordStress(word, stressedWord);
      
      // Удаляем модальное окно и overlay
      document.body.removeChild(modal);
      document.body.removeChild(overlay);
      
      hideSelectionOverlay();
      selectionMode = false;
      document.body.style.cursor = 'default';
      
      showNotification('Ударение сохранено: ' + stressedWord);
    }, true); // Используем capturing phase
  });

  document.getElementById('cancel-stress').addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    document.body.removeChild(modal);
    document.body.removeChild(overlay);
    
    hideSelectionOverlay();
    selectionMode = false;
    document.body.style.cursor = 'default';
    
    showNotification('Выбор отменен');
  }, true);
}

function saveWordStress(original, stressed) {
  chrome.storage.local.get(['stressedWords'], function(result) {
    let words = result.stressedWords || [];
    
    // Проверяем, не существует ли уже такое слово
    const existingIndex = words.findIndex(w => w.original.toLowerCase() === original.toLowerCase());
    if (existingIndex !== -1) {
      words[existingIndex] = {original, stressed};
    } else {
      words.push({original, stressed});
    }
    
    chrome.storage.local.set({stressedWords: words}, function() {
      wordsWithStress = words;
      applyStresses();
      chrome.runtime.sendMessage({action: 'stressSaved', word: stressed});
    });
  });
}

function applyStresses() {
  if (!wordsWithStress || wordsWithStress.length === 0) return;

  console.log('Применяем ударения к странице');
  
  // Сохраняем текущие позиции прокрутки
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  // Сначала находим все текстовые узлы
  const textNodes = [];
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Пропускаем скрипты, стили и элементы нашего расширения
        if (node.parentElement && (
            node.parentElement.tagName === 'SCRIPT' || 
            node.parentElement.tagName === 'STYLE' ||
            node.parentElement.tagName === 'NOSCRIPT' ||
            node.parentElement.id === 'stress-modal' ||
            node.parentElement.id === 'modal-overlay' ||
            node.parentElement.id === 'phrase-highlight' ||
            node.parentElement.id === 'stress-notification' ||
            node.parentElement.classList.contains('stressed-word-wrapper')
        )) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Пропускаем пустые текстовые узлы
        if (!node.textContent.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  // Применяем ударения к каждому текстовому узлу
  let modifiedCount = 0;
  
  textNodes.forEach(node => {
    let text = node.textContent;
    let modified = false;
    let resultHTML = text;

    wordsWithStress.forEach(wordObj => {
      // Создаем регулярное выражение для поиска слова с учетом границ слова
      // Используем word boundaries, но учитываем русские буквы
      const regex = new RegExp('(^|[\\s\\p{P}])(' + escapeRegExp(wordObj.original) + ')([\\s\\p{P}]|$)', 'gu');
      
      // Проверяем, есть ли слово в тексте
      if (regex.test(resultHTML)) {
        // Заменяем слово на HTML с выделением
        resultHTML = resultHTML.replace(regex, function(match, before, word, after) {
          // Добавляем класс для стилизации
          return before + `<span class="stressed-word" title="Ударение: ${wordObj.stressed}">${wordObj.stressed}</span>` + after;
        });
        modified = true;
      }
    });

    if (modified) {
      // Создаем контейнер для замены
      const span = document.createElement('span');
      span.className = 'stressed-word-wrapper';
      span.innerHTML = resultHTML;
      
      // Заменяем текстовый узел на наш span
      node.parentNode.replaceChild(span, node);
      modifiedCount++;
    }
  });

  console.log(`Применено ударений к ${modifiedCount} элементам`);

  // Добавляем стили для выделения слов с ударением, если их еще нет
  addStressStyles();
  
  // Восстанавливаем позицию прокрутки
  window.scrollTo(scrollX, scrollY);
}

// Добавляем стили для выделения слов с ударением
function addStressStyles() {
  // Проверяем, есть ли уже стили
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
    
    /* Для символа ударения */
    .stressed-word u {
      text-decoration: none;
      font-weight: bold;
      color: #4CAF50;
    }
    
    /* Подсветка при наведении на список слов в popup */
    .stressed-word.highlight {
      background-color: rgba(255, 193, 7, 0.3);
      border-bottom-color: #FFC107;
      animation: pulse 0.5s ease-in-out;
    }
    
    @keyframes pulse {
      0% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.05);
      }
      100% {
        transform: scale(1);
      }
    }
  `;
  document.head.appendChild(style);
}

// Функция для подсветки конкретного слова (можно вызвать из popup)
function highlightWord(original) {
  const elements = document.querySelectorAll('.stressed-word');
  let highlighted = false;
  
  elements.forEach(el => {
    if (el.textContent.includes(original)) {
      el.classList.add('highlight');
      // Прокручиваем к первому найденному слову
      if (!highlighted) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlighted = true;
      }
      setTimeout(() => {
        el.classList.remove('highlight');
      }, 2000);
    }
  });
  
  if (!highlighted) {
    showNotification('Слово "' + original + '" не найдено на странице');
  }
}

// Вспомогательная функция для экранирования спецсимволов в регулярных выражениях
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function showNotification(message) {
  // Удаляем предыдущее уведомление, если оно есть
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
    border-radius: 5px;
    z-index: 10002;
    font-size: 14px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    animation: slideIn 0.3s, fadeOut 0.3s 2.7s forwards;
    max-width: 300px;
    word-wrap: break-word;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 3000);
}

function hideSelectionOverlay() {
  const overlay = document.getElementById('phrase-highlight');
  if (overlay) {
    overlay.remove();
  }
  
  const modal = document.getElementById('stress-modal');
  if (modal) {
    modal.remove();
  }
  
  const modalOverlay = document.getElementById('modal-overlay');
  if (modalOverlay) {
    modalOverlay.remove();
  }
}

// Добавляем стили для анимации, если их еще нет
if (!document.getElementById('animation-styles')) {
  const style = document.createElement('style');
  style.id = 'animation-styles';
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    
    @keyframes fadeOut {
      from {
        opacity: 1;
      }
      to {
        opacity: 0;
      }
    }
    
    .stress-btn:hover {
      background-color: #45a049 !important;
    }
    
    #cancel-stress:hover {
      background-color: #d32f2f !important;
    }
  `;
  document.head.appendChild(style);
}