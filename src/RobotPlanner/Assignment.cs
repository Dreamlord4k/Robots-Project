public class Assignment
{
    public Order Order { get; set; }
    public string Source { get; set; } // "Warehouse" или "Line: <Name>"
    public int HoursUsed { get; set; }
}
