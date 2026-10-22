namespace FactoryChallenge.Core.Models;

// Идея: один класс = один файл data/config.json. Секции повторяют структуру JSON,
// поэтому связка получается «как в файле», без ручных маппингов.
public sealed class FactoryConfig
{
    public RoundConfig Round { get; init; } = new();
    public WarehouseConfig Warehouse { get; init; } = new();
    public SupplyConfig Supply { get; init; } = new();
    public PricingConfig Pricing { get; init; } = new();
    public StrategyConfig Strategy { get; init; } = new();
    public OutputConfig Output { get; init; } = new();
}

public sealed class RoundConfig
{
    public double DurationSeconds { get; init; } = 600;
    public double TickSeconds { get; init; } = 0.5;
    public int RandomSeed { get; init; } = 42;
}

public sealed class WarehouseConfig
{
    public double CapacitySlots { get; init; } = 36;
    public double SlotVolume { get; init; } = 1.0;
    public decimal StorageCostPerSlotSecond { get; init; } = 0.02m;
    public double ReserveSlotsForWorkInProgress { get; init; } = 6;
}

public sealed class SupplyWeight
{
    public string MaterialId { get; init; } = string.Empty;
    public int Weight { get; init; } = 1;
}

public sealed class SupplyConfig
{
    public double IntervalSeconds { get; init; } = 9;
    public double JitterSeconds { get; init; } = 3;
    public int BatchSizeMin { get; init; } = 2;
    public int BatchSizeMax { get; init; } = 7;
    public IReadOnlyList<SupplyWeight> Materials { get; init; } = Array.Empty<SupplyWeight>();
}

public sealed class PricingConfig
{
    public decimal EnergyTariffPerKwh { get; init; } = 7.2m;
    public double DefectScrapCostFactor { get; init; } = 0.35;
    public double CustomerReplySecondsMin { get; init; } = 1.0;
    public double CustomerReplySecondsMax { get; init; } = 4.0;
    public double FinishedRobotSlots { get; init; } = 2.0;
}

// Важно: пороги стратегии лежат в конфиге, чтобы «подкрутить жадность» можно было без правки кода.
public sealed class StrategyConfig
{
    /// Ниже этой прибыли в минуту робота не производим вообще (отсекаем убыточные типы).
    public decimal MinimumProfitPerMinute { get; init; } = 40m;

    /// Если склад заполнен сильнее — новые поставки отклоняем.
    public double MaxWarehouseFillRatio { get; init; } = 0.8;

    /// Аварийный порог: выше него отклоняем всё, кроме критичного дефицита.
    public double UrgentFillRatio { get; init; } = 0.95;

    /// Небольшая надбавка к приоритету, если станок уже настроен на этот тип (экономия на переналадке).
    public double SameTypeSetupBonus { get; init; } = 0.08;

    /// На сколько секунд работы завода хотим держать запас материалов на складе.
    public double TargetStockCoverageSeconds { get; init; } = 120;

    /// Сколько готовых роботов максимум держим «в витрине» до продажи.
    public int MaxFinishedBuffer { get; init; } = 3;
}

public sealed class OutputConfig
{
    public string ResultsJsonPath { get; init; } = "../site/data/results.json";
    public int MaxLogEntries { get; init; } = 200;
}
