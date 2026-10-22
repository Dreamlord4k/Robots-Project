namespace FactoryChallenge.Core.Models;

// Идея: предпочтение — это «строкa прайса». Один покупатель может хотеть несколько типов,
// но по разным ценам и с разной готовностью согласиться.
public sealed class CustomerPreference
{
    public string RobotTypeId { get; init; } = string.Empty;
    public decimal Price { get; init; }
    public int MaxUnits { get; init; } = int.MaxValue;

    /// Вероятность согласия по этой цене. 1.0 — берёт всегда.
    /// Важно: именно она даёт сценарий «робот отклонён → предлагаем другому покупателю».
    public double AcceptChance { get; init; } = 1.0;
}

public sealed class Customer
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Segment { get; init; } = string.Empty;

    public IReadOnlyList<CustomerPreference> Preferences { get; init; } = Array.Empty<CustomerPreference>();

    public int TotalBought { get; private set; }

    private readonly Dictionary<string, int> _boughtByRobot = new();

    public int BoughtOf(string robotTypeId) =>
        _boughtByRobot.TryGetValue(robotTypeId, out var count) ? count : 0;

    // Идея: лучшая сделка = максимальная цена среди тех, кто ещё не выбрал свой лимит.
    // Стратегия идёт по этому списку сверху вниз и после отказа переходит к следующему покупателю.
    public CustomerPreference? BestOfferFor(string robotTypeId) =>
        Preferences
            .Where(p => p.RobotTypeId == robotTypeId && BoughtOf(robotTypeId) < p.MaxUnits)
            .OrderByDescending(p => p.Price)
            .FirstOrDefault();

    public bool Wants(string robotTypeId) => BestOfferFor(robotTypeId) is not null;

    public decimal PriceFor(string robotTypeId) => BestOfferFor(robotTypeId)?.Price ?? 0m;

    public void RecordSale(string robotTypeId)
    {
        _boughtByRobot[robotTypeId] = BoughtOf(robotTypeId) + 1;
        TotalBought++;
    }
}
