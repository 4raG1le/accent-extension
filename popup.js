document.addEventListener('DOMContentLoaded', function() {
  const selectStressBtn = document.getElementById('selectStress');
  const clearSelectionBtn = document.getElementById('clearSelection');
  const statusDiv = document.getElementById('status');
  const wordListDiv = document.getElementById('wordList');

  // Загружаем сохраненные слова
  loadWordList();

  selectStressBtn.addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {action: 'startSelection'}, function(response) {
        if (response && response.status === 'started') {
          statusDiv.textContent = 'Выберите фразу...';
          selectStressBtn.disabled = true;
          clearSelectionBtn.disabled = false;
        }
      });
    });
  });

  clearSelectionBtn.addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {action: 'cancelSelection'}, function() {
        statusDiv.textContent = 'Выбор отменен';
        selectStressBtn.disabled = false;
        clearSelectionBtn.disabled = true;
      });
    });
  });

  // Слушаем сообщения от content script
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'wordSelected') {
      statusDiv.textContent = 'Выберите ударение в слове: ' + request.word;
    } else if (request.action === 'stressSaved') {
      statusDiv.textContent = 'Ударение сохранено!';
      selectStressBtn.disabled = false;
      clearSelectionBtn.disabled = true;
      loadWordList(); // Обновляем список слов
    }
  });

  function loadWordList() {
    chrome.storage.local.get(['stressedWords'], function(result) {
      const words = result.stressedWords || [];
      wordListDiv.innerHTML = '';
      
      if (words.length === 0) {
        wordListDiv.innerHTML = '<div class="word-item">Нет сохраненных слов</div>';
        return;
      }

      words.forEach(function(wordObj, index) {
        const wordDiv = document.createElement('div');
        wordDiv.className = 'word-item';
        
        // Создаем HTML с выделенным ударением
        const stressedHtml = wordObj.stressed.replace(/\u0301/g, '<span style="color: #4CAF50; font-weight: bold;">́</span>');
        
        wordDiv.innerHTML = `
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="word-text" data-original="${wordObj.original}" style="cursor: pointer;" title="Нажмите, чтобы подсветить на странице">
              ${wordObj.original} → ${stressedHtml}
            </span>
            <span class="remove-word" data-index="${index}" style="color: #ff4444; cursor: pointer; font-size: 18px; font-weight: bold;">×</span>
          </div>
        `;
        
        wordListDiv.appendChild(wordDiv);
      });

      // Добавляем обработчики для подсветки слов при наведении
      document.querySelectorAll('.word-text').forEach(el => {
        el.addEventListener('mouseenter', function() {
          const original = this.dataset.original;
          chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'highlightWord', 
              word: original
            });
          });
        });
      });

      // Добавляем обработчики для удаления слов
      document.querySelectorAll('.remove-word').forEach(btn => {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          const index = parseInt(this.dataset.index);
          removeWord(index);
        });
      });
    });
  }

  function removeWord(index) {
    chrome.storage.local.get(['stressedWords'], function(result) {
      const words = result.stressedWords || [];
      words.splice(index, 1);
      chrome.storage.local.set({stressedWords: words}, function() {
        loadWordList();
        // Обновляем ударения на странице
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          chrome.tabs.sendMessage(tabs[0].id, {action: 'updateStresses', words: words});
        });
      });
    });
  }
});