namespace FactoryChallenge.Core.Models;

// Идея: Material — это то, что приезжает поставкой. Price нужна для себестоимости,
// Volume — чтобы понимать, сколько слотов склада съест партия.
public sealed record Material(
    string Id,
    string Name,
    string Unit,
    decimal Price,
    double Volume);

// Идея: потребность конкретного робота в конкретном материале.
// Отдельный тип, чтобы в robots.json состав читался как «2 листа, 1 модуль», а не как словарь.
public sealed record MaterialRequirement(string MaterialId, int Quantity);
