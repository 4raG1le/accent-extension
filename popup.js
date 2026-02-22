document.addEventListener('DOMContentLoaded', function() {
  const selectStressBtn = document.getElementById('selectStress');
  const clearSelectionBtn = document.getElementById('clearSelection');
  const statusDiv = document.getElementById('status');
  const wordListDiv = document.getElementById('wordList');

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

  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'stressSaved') {
      statusDiv.textContent = 'Ударение сохранено!';
      selectStressBtn.disabled = false;
      clearSelectionBtn.disabled = true;
      loadWordList();
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
        
        const date = new Date(wordObj.timestamp);
        const timeStr = date.toLocaleTimeString();
        
        wordDiv.innerHTML = `
          <div style="display: flex; align-items: center; gap: 10px; width:100%;">
            <span class="word-text" data-word-id="${wordObj.id}" style="cursor: pointer; flex-grow:1;" title="Нажмите, чтобы подсветить на странице">
              <span style="color:#666; font-size:11px;">${timeStr}</span><br>
              <strong>${wordObj.original}</strong> → <span style="color:#4CAF50;">${wordObj.stressed}</span>
            </span>
            <span class="remove-word" data-index="${index}" style="color: #ff4444; cursor: pointer; font-size: 18px; font-weight: bold;">×</span>
          </div>
        `;
        
        wordListDiv.appendChild(wordDiv);
      });

      document.querySelectorAll('.word-text').forEach(el => {
        el.addEventListener('click', function() {
          const wordId = this.dataset.wordId;
          chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'highlightWord',
              wordId: wordId
            });
          });
        });
      });

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
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          chrome.tabs.sendMessage(tabs[0].id, {action: 'updateStresses', words: words});
        });
      });
    });
  }
});