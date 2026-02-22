// Фоновый скрипт для обработки событий расширения

chrome.runtime.onInstalled.addListener(function() {
  console.log('Расширение "Ударение в словах" установлено');
  
  // Инициализируем хранилище
  chrome.storage.local.get(['stressedWords'], function(result) {
    if (!result.stressedWords) {
      chrome.storage.local.set({stressedWords: []});
    }
  });
});

// Слушаем события обновления вкладок
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  // Когда страница полностью загружена
  if (changeInfo.status === 'complete') {
    // Отправляем сообщение content script для применения ударений
    chrome.tabs.sendMessage(tabId, { 
      action: 'pageLoaded',
      url: tab.url 
    }).catch(() => {
      // Игнорируем ошибки, если content script еще не загружен
    });
  }
});

// Слушаем активацию вкладок (когда пользователь переключается на вкладку)
chrome.tabs.onActivated.addListener(function(activeInfo) {
  chrome.tabs.get(activeInfo.tabId, function(tab) {
    chrome.tabs.sendMessage(activeInfo.tabId, { 
      action: 'tabActivated',
      url: tab.url 
    }).catch(() => {
      // Игнорируем ошибки
    });
  });
});

// Обработка сообщений от content script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'getStressedWords') {
    chrome.storage.local.get(['stressedWords'], function(result) {
      sendResponse({words: result.stressedWords || []});
    });
    return true; // Для асинхронного ответа
  }
});