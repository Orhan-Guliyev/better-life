const MODELS = ['gemini-1.5-pro', 'gemini-1.5-flash'];

/**
 * Умная каскадная функция запроса к Gemini API
 */
export async function fetchGeminiCascade({ userMessage, systemPrompt, history, apiKeys, onKeyInvalid, onToast }) {
    // 1. Фильтруем только заполненные и незаблокированные ключи
    const activeKeys = apiKeys.filter(key => key.value && key.value.trim() !== '' && !key.invalid);

    if (activeKeys.length === 0) {
        throw new Error("Нет доступных рабочих API-ключей. Проверьте настройки профиля.");
    }

    // 2. Формируем контекст истории согласно требованиям Google API (v1beta)
    const contents = history.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
    }));
    
    // Добавляем текущее новое сообщение пользователя в конец массива структуры данных
    contents.push({
        role: 'user',
        parts: [{ text: userMessage }]
    });

    const payload = {
        system_instruction: {
            parts: [{ text: systemPrompt }]
        },
        contents: contents,
        generationConfig: {
            temperature: 0.7
        }
    };

    // 3. Главный цикл каскада по МОДЕЛЯМ (сверху вниз)
    for (const model of MODELS) {
        // Внутренний цикл перебора по КЛЮЧАМ для выбранной модели
        for (const currentKey of activeKeys) {
            
            // Если в процессе выполнения предыдущих шагов этот ключ пометился невалидным — пропускаем его
            if (currentKey.invalid) continue;

            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey.value}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                // Обработка статус-кодов ошибок от сервера Google
                if (!response.ok) {
                    const status = response.status;
                    const errorMsg = result.error?.message || "Неизвестная ошибка API";

                    if (status === 400 || status === 403) {
                        // КЛЮЧ НЕВАЛИДЕН (Неверный синтаксис, отозван, заблокирован)
                        currentKey.invalid = true; // Локальный маркер
                        onToast(`Ключ №${currentKey.id} недействителен и исключен из каскада!`, 'error');
                        
                        // Вызываем внешнее обновление состояния в базе данных Supabase
                        await onKeyInvalid(currentKey.id);
                        continue; // Прерываем операцию для этого ключа и идем к следующему
                    } 
                    
                    if (status === 429) {
                        // ИСЧЕРПАНЫ ЛИМИТЫ (Quota Exceeded)
                        onToast(`На модели ${model} Ключ №${currentKey.id} исчерпал лимиты (429). Переключаюсь...`, 'warning');
                        continue; // Идем к следующему ключу для этой же модели
                    }

                    // Любая другая системная критическая ошибка
                    throw new Error(`[API Error ${status}]: ${errorMsg}`);
                }

                // Успешное получение генерации контента
                if (result.candidates && result.candidates[0]?.content?.parts?.[0]?.text) {
                    return {
                        text: result.candidates[0].content.parts[0].text,
                        usedModel: model,
                        usedKeyId: currentKey.id
                    };
                } else {
                    throw new Error("Структура ответа API изменена или пуста.");
                }

            } catch (err) {
                console.error(`Сбой на модели ${model}, ключ №${currentKey.id}:`, err);
                // Если произошла сетевая ошибка Fetch (нет интернета), продолжаем каскад по цепочке
                continue;
            }
        }
    }

    // Если проитерировали все модели и все ключи, но ничего не вернулось
    throw new Error("Лимиты ваших API-ключей временно исчерпаны на всех доступных моделях.");
}