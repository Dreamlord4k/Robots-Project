namespace FactoryChallenge.Core.Models;

// Идея: операция — единственное, что связывает рецепт робота и станок.
// Рецепт говорит «нужно Cutting, потом Assembly», станок говорит «я умею только Cutting».
// Поэтому новый станок или новая операция не требуют правок в алгоритме.
public enum Operation
{
    Cutting,
    Painting,
    Assembly,
    Calibration
}

public static class OperationNames
{
    // Важно: в JSON операции хранятся строками ("Cutting"). Имена в JSON и в enum обязаны совпадать
    // посимвольно — иначе загрузчик упадёт с понятной ошибкой (см. JsonDataLoader).
    public static string ToRussian(this Operation operation) => operation switch
    {
        Operation.Cutting     => "Резка",
        Operation.Painting    => "Покраска",
        Operation.Assembly    => "Сборка",
        Operation.Calibration => "Калибровка",
        _ => operation.ToString()
    };
}
