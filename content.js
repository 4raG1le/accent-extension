let selectionMode = false;
let selectedPhrase = '';
let selectedWord = '';
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
    } else {
      console.log('Нет сохраненных слов с ударениями');
    }
    isInitialized = true;
  });
}

// Запускаем инициализацию
initializeExtension();

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
    selectedPhrase = '';
    selectedWord = '';
    selectedElement = null;
    selectedRange = null;
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
    if (request.wordId) {
      highlightWordById(request.wordId);
    } else if (request.word) {
      highlightWordByText(request.word);
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
  if (!selectionMode) return;
  
  // Проверяем, не кликнули ли по модальному окну
  if (e.target.closest('#stress-modal') || e.target.closest('.stress-btn')) {
    return;
  }
  
  e.preventDefault();
  e.stopPropagation();

  if (!selectedPhrase) {
    // Первый клик - выбираем фразу
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;
    
    selectedRange = range;
    selectedElement = range.startContainer;
    selectedPhrase = getPhraseFromRange(range);
    
    if (selectedPhrase) {
      highlightPhrase(selectedPhrase);
      showNotification('Теперь выберите слово в фразе');
    }
  } else if (!selectedWord) {
    // Второй клик - выбираем слово
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;
    
    const word = getWordFromRange(range);
    if (word && selectedPhrase.includes(word)) {
      selectedWord = word;
      showStressSelection(word, selectedElement, selectedRange);
    } else {
      showNotification('Выберите слово из выделенной фразы');
    }
  }
}, true);

function getPhraseFromRange(range) {
  if (!range) return '';
  
  const node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    // Берем всю строку или предложение
    const lines = text.split('\n');
    let charCount = 0;
    
    for (let line of lines) {
      if (range.startOffset >= charCount && range.startOffset <= charCount + line.length) {
        return line.trim();
      }
      charCount += line.length + 1;
    }
  }
  return '';
}

function getWordFromRange(range) {
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
    
    return text.substring(start, end).trim();
  }
  return '';
}

function highlightPhrase(phrase) {
  hideSelectionOverlay();
  
  // Создаем полупрозрачный overlay
  const overlay = document.createElement('div');
  overlay.id = 'phrase-highlight';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(255, 255, 0, 0.1);
    pointer-events: none;
    z-index: 10000;
  `;
  document.body.appendChild(overlay);
  
  showNotification('Выбрана фраза: "' + phrase + '"');
}

function showStressSelection(word, element, range) {
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

  const letters = word.split('');
  let html = '<h3 style="margin:0 0 15px 0; color:#333;">Выберите ударную гласную:</h3>';
  html += '<div style="font-size:20px; margin-bottom:20px; padding:10px; background:#f5f5f5; border-radius:8px;">"' + word + '"</div>';
  html += '<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-bottom:20px;">';
  
  letters.forEach((letter, index) => {
    if ('аеёиоуыэюяАЕЁИОУЫЭЮЯ'.includes(letter)) {
      const before = word.substring(0, index);
      const after = word.substring(index + 1);
      const stressedChar = letter + '\u0301';
      const stressedWord = before + stressedChar + after;
      
      html += `<button class="stress-btn" 
        data-stressed="${stressedWord}" 
        data-index="${index}"
        data-original="${word}"
        style="margin: 2px; padding: 12px 18px; background-color: #4CAF50; color: white; border: none; border-radius: 6px; cursor: pointer; font-size:18px; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">
        ${stressedWord}
      </button>`;
    }
  });
  
  html += '</div>';
  html += '<div style="display: flex; gap: 10px; justify-content: center;">';
  html += '<button id="cancel-stress" style="padding: 10px 25px; background-color: #f44336; color: white; border: none; border-radius: 6px; cursor: pointer; font-size:14px;">Отмена</button>';
  html += '<button id="save-all" style="padding: 10px 25px; background-color: #2196F3; color: white; border: none; border-radius: 6px; cursor: pointer; font-size:14px;">Применить ко всем</button>';
  html += '</div>';
  
  modal.innerHTML = html;
  document.body.appendChild(modal);

  // Затемнение фона
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

  // Обработка кнопок с ударением
  modal.querySelectorAll('.stress-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      const stressedWord = this.dataset.stressed;
      const originalWord = this.dataset.original;
      
      // Сохраняем для конкретного слова
      saveWordStress(originalWord, stressedWord, true, element, range);
      
      closeModal(modal, overlay);
    }, true);
  });

  // Кнопка "Применить ко всем"
  document.getElementById('save-all').addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Берем первую гласную как ударение по умолчанию
    const firstBtn = modal.querySelector('.stress-btn');
    if (firstBtn) {
      const stressedWord = firstBtn.dataset.stressed;
      const originalWord = firstBtn.dataset.original;
      
      // Сохраняем для всех вхождений
      saveWordStress(originalWord, stressedWord, false);
    }
    
    closeModal(modal, overlay);
  });

  document.getElementById('cancel-stress').addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    closeModal(modal, overlay);
    selectionMode = false;
    document.body.style.cursor = 'default';
    hideSelectionOverlay();
    showNotification('Выбор отменен');
  }, true);
}

function closeModal(modal, overlay) {
  if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
}

function saveWordStress(original, stressed, specificOnly, element, range) {
  chrome.storage.local.get(['stressedWords'], function(result) {
    let words = result.stressedWords || [];
    
    let wordObj;
    
    if (specificOnly && element && range) {
      // Сохраняем для конкретного слова
      const path = getElementPath(element);
      wordObj = {
        id: generateId(),
        original: original,
        stressed: stressed,
        elementPath: path,
        textPosition: range.startOffset,
        specific: true,
        timestamp: Date.now()
      };
    } else {
      // Сохраняем для всех вхождений
      wordObj = {
        id: generateId(),
        original: original,
        stressed: stressed,
        specific: false,
        timestamp: Date.now()
      };
    }
    
    // Удаляем старую запись для этого же слова (если есть)
    const existingIndex = words.findIndex(w => 
      w.original === original && w.specific === wordObj.specific
    );
    
    if (existingIndex !== -1) {
      words[existingIndex] = wordObj;
    } else {
      words.push(wordObj);
    }
    
    chrome.storage.local.set({stressedWords: words}, function() {
      wordsWithStress = words;
      applyStresses();
      
      const message = specificOnly ? 
        'Ударение сохранено для конкретного слова' : 
        'Ударение будет применяться ко всем словам "' + original + '"';
      
      showNotification(message);
      
      chrome.runtime.sendMessage({
        action: 'stressSaved', 
        word: stressed,
        wordId: wordObj.id
      });
      
      selectionMode = false;
      document.body.style.cursor = 'default';
      hideSelectionOverlay();
    });
  });
}

function generateId() {
  return 'word_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getElementPath(element) {
  if (!element) return '';
  
  // Поднимаемся до элемента, если это текстовый узел
  while (element && element.nodeType === Node.TEXT_NODE) {
    element = element.parentNode;
  }
  
  if (!element) return '';
  
  const path = [];
  while (element && element !== document.body) {
    let selector = element.tagName.toLowerCase();
    if (element.id) {
      selector += '#' + element.id;
    } else if (element.className) {
      const classes = element.className.split(' ').filter(c => c.trim());
      if (classes.length) {
        selector += '.' + classes.join('.');
      }
    }
    path.unshift(selector);
    element = element.parentNode;
  }
  
  return path.join(' > ');
}

function applyStresses() {
  if (!wordsWithStress || wordsWithStress.length === 0) return;

  console.log('Применяем ударения к странице');
  
  // Сначала применяем общие правила (для всех вхождений)
  const generalWords = wordsWithStress.filter(w => !w.specific);
  
  // Затем применяем специфичные (для конкретных слов)
  const specificWords = wordsWithStress.filter(w => w.specific);

  // Применяем общие правила ко всем текстовым узлам
  if (generalWords.length > 0) {
    applyGeneralStresses(generalWords);
  }
  
  // Применяем специфичные правила
  if (specificWords.length > 0) {
    applySpecificStresses(specificWords);
  }
  
  addStressStyles();
}

function applyGeneralStresses(words) {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        if (node.parentElement && (
            node.parentElement.tagName === 'SCRIPT' || 
            node.parentElement.tagName === 'STYLE' ||
            node.parentElement.id === 'stress-modal' ||
            node.parentElement.id === 'modal-overlay' ||
            node.parentElement.classList.contains('stressed-word')
        )) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  textNodes.forEach(node => {
    let text = node.textContent;
    let modified = false;
    let resultHTML = text;

    words.forEach(wordObj => {
      const regex = new RegExp('\\b' + escapeRegExp(wordObj.original) + '\\b', 'g');
      
      if (regex.test(resultHTML)) {
        resultHTML = resultHTML.replace(regex, function(match) {
          return `<span class="stressed-word" data-word-id="${wordObj.id}" title="Ударение: ${wordObj.stressed}">${wordObj.stressed}</span>`;
        });
        modified = true;
      }
    });

    if (modified) {
      const span = document.createElement('span');
      span.innerHTML = resultHTML;
      node.parentNode.replaceChild(span, node);
    }
  });
}

function applySpecificStresses(words) {
  words.forEach(wordObj => {
    try {
      // Ищем элемент по пути
      const element = findElementByPath(wordObj.elementPath);
      if (!element) return;
      
      // Ищем текстовые узлы в элементе
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
      
      // В каждом текстовом узле ищем наше слово
      textNodes.forEach(node => {
        const text = node.textContent;
        const position = wordObj.textPosition;
        
        // Проверяем, содержит ли узел наше слово примерно в нужной позиции
        if (text.includes(wordObj.original)) {
          // Заменяем конкретное вхождение
          let resultHTML = '';
          let lastIndex = 0;
          let found = false;
          
          const regex = new RegExp(escapeRegExp(wordObj.original), 'g');
          let match;
          
          while ((match = regex.exec(text)) !== null) {
            // Если это похоже на нужную позицию
            if (!found && Math.abs(match.index - position) < wordObj.original.length) {
              resultHTML += text.substring(lastIndex, match.index);
              resultHTML += `<span class="stressed-word specific" data-word-id="${wordObj.id}" title="Ударение: ${wordObj.stressed}">${wordObj.stressed}</span>`;
              lastIndex = match.index + wordObj.original.length;
              found = true;
            }
          }
          
          if (found) {
            resultHTML += text.substring(lastIndex);
            
            const span = document.createElement('span');
            span.innerHTML = resultHTML;
            node.parentNode.replaceChild(span, node);
          }
        }
      });
    } catch (e) {
      console.log('Ошибка при применении специфичного ударения:', e);
    }
  });
}

function findElementByPath(path) {
  try {
    return document.querySelector(path);
  } catch (e) {
    return null;
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
    
    .stressed-word.specific {
      border-bottom-color: #FF9800;
      background-color: rgba(255, 152, 0, 0.1);
    }
    
    .stressed-word.specific:hover {
      background-color: rgba(255, 152, 0, 0.3);
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

function highlightWordByText(word) {
  const elements = document.querySelectorAll('.stressed-word');
  let found = false;
  
  elements.forEach(el => {
    if (el.textContent.includes(word)) {
      el.classList.add('highlight');
      if (!found) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        found = true;
      }
      
      setTimeout(() => {
        el.classList.remove('highlight');
      }, 2000);
    }
  });
  
  if (!found) {
    showNotification('Слово "' + word + '" не найдено на странице');
  }
}

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

function hideSelectionOverlay() {
  const overlay = document.getElementById('phrase-highlight');
  if (overlay) overlay.remove();
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