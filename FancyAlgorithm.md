graph TD
    %% Стилизация для наглядности
    classDef input fill:#e1f5fe,stroke:#0277bd;
    classDef process fill:#fff3e0,stroke:#ef6c00;
    classDef output fill:#e8f5e9,stroke:#2e7d32;
    classDef decision fill:#ffebee,stroke:#c62828;

    %% Входные данные (то, что мы выносим в JSON)
    A[Вход: данные из JSON<br/>- Заказы (orders.json)<br/>- Линии (lines.json)<br/>- Склад (stock.json)]:::input

    A --> B[Загрузка и парсинг JSON<br/>(System.Text.Json)]:::process
    B --> C{Данные валидны?}:::decision
    C -- Нет --> D[Показать ошибку, завершить]:::output
    C -- Да --> E[Сортировка заказов по цене<br/>(убывание — жадная стратегия)]:::process

    E --> F{Есть остатки на складе?}:::decision
    F -- Да --> G[Отгрузить со склада<br/>Уменьшить Quantity]:::process
    F -- Нет --> H{Хватает часов на линии?}:::decision

    H -- Да --> I[Назначить на линию<br/>Уменьшить AvailableHours]:::process
    H -- Нет --> J[Пометить как невыполненный<br/>Причина: нет мощностей]:::output

    G --> K[Записать в Assigned]:::process
    I --> K
    J --> L[Записать в Unassigned]:::process

    K --> M[Подсчёт выручки]:::process
    L --> N[Подсчёт статистики<br/>Типы роботов, кол-во]:::process

    M --> O[Формирование PlanResult]:::process
    N --> O

    O --> P[Вывод в консоль:<br/>- Выполненные заказы<br/>- Выручка<br/>- Невыполненные<br/>- Статистика]:::output
