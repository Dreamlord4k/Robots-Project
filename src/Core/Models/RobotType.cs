namespace FactoryChallenge.Core.Models;

// Идея: шаг рецепта — «одна операция и во сколько раз она дольше базовой».
// Множитель позволяет тяжёлому «Титану» занимать сборочный пост дольше, чем «Скауту»,
// не заводя отдельное время для каждой пары (робот, станок).
public sealed record RecipeStep(Operation Operation, double TimeMultiplier);

public sealed class RobotType
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;

    // Рыночный ориентир. Реальную цену даёт покупатель, поэтому basePrice — только для отладки и UI.
    public decimal BasePrice { get; init; }

    /// Маршрут по операциям в порядке выполнения. Порядок важен: заготовка идёт по шагам слева направо.
    public IReadOnlyList<RecipeStep> Recipe { get; init; } = Array.Empty<RecipeStep>();

    /// Состав изделия: что нужно списать со склада, чтобы начать производство.
    public IReadOnlyList<MaterialRequirement> Materials { get; init; } = Array.Empty<MaterialRequirement>();

    /// Себестоимость материалов по текущему справочнику цен.
    public decimal MaterialCost(IReadOnlyDictionary<string, Material> catalog) =>
        Materials.Sum(req => req.Quantity *
            (catalog.TryGetValue(req.MaterialId, out var material) ? material.Price : 0m));

    /// Нужна ли этому роботу конкретная операция (нужно стратегии, чтобы не гонять заготовку лишний раз).
    public bool Needs(Operation operation) => Recipe.Any(step => step.Operation == operation);

    /// Номер операции в маршруте, -1 если операции нет. По нему проверяется очерёдность шагов.
    public int StepIndex(Operation operation)
    {
        for (var i = 0; i < Recipe.Count; i++)
        {
            if (Recipe[i].Operation == operation) return i;
        }
        return -1;
    }

    public int StepCount => Recipe.Count;
}
