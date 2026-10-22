```mermaid
graph TD
    %% Стилизация
    classDef input fill:#e1f5fe,stroke:#0277bd;
    classDef process fill:#fff3e0,stroke:#ef6c00;
    classDef output fill:#e8f5e9,stroke:#2e7d32;
    classDef decision fill:#ffebee,stroke:#c62828;

    %% Входные данные
    A[Вход: данные из JSON\n- Заказы (orders.json)\n- Линии (lines.json)\n- Склад (stock.json)]:::input

    A --> B[Загрузка и парсинг JSON\n(System.Text.Json)]:::process
    B --> C{Данные валидны?}:::decision
    C -- Нет --> D[Показать ошибку, завершить]:::output
    C -- Да --> E[Сортировка заказов по цене\n(убывание — жадная стратегия)]:::process

    E --> F{Есть остатки на складе?}:::decision
    F -- Да --> G[Отгрузить со склада\nУменьшить Quantity]:::process
    F -- Нет --> H{Хватает часов на линии?}:::decision

    H -- Да --> I[Назначить на линию\nУменьшить AvailableHours]:::process
    H -- Нет --> J[Пометить как невыполненный\nПричина: нет мощностей]:::output

    G --> K[Записать в Assigned]:::process
    I --> K
    J --> L[Записать в Unassigned]:::process

    K --> M[Подсчёт выручки]:::process
    L --> N[Подсчёт статистики\nТипы роботов, кол-во]:::process

    M --> O[Формирование PlanResult]:::process
    N --> O

    O --> P[Вывод в консоль:\n- Выполненные заказы\n- Выручка\n- Невыполненные\n- Статистика]:::output
```
