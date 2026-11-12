import java.util.*;

public class Bank {
  // One monitor for the whole ledger: a transfer touches two accounts at once, and a lock
  // per account would need an ordering to avoid deadlock.
  private final Map<String, Long> accounts = new HashMap<>();

  private long get(String account) {
    Long balance = accounts.get(account);
    if (balance == null) throw new NoSuchElementException("unknown account");
    return balance;
  }

  private static void positive(long amount) {
    if (amount <= 0) throw new IllegalArgumentException("amount must be positive");
  }

  public synchronized void open(String account, long balance) {
    if (balance < 0) throw new IllegalArgumentException("negative opening balance");
    if (accounts.containsKey(account)) throw new IllegalStateException("account exists");
    accounts.put(account, balance);
  }

  public synchronized long deposit(String account, long amount) {
    positive(amount);
    long balance = get(account) + amount;
    accounts.put(account, balance);
    return balance;
  }

  public synchronized boolean withdraw(String account, long amount) {
    positive(amount);
    long balance = get(account);
    if (balance < amount) return false;
    accounts.put(account, balance - amount);
    return true;
  }

  public synchronized boolean transfer(String source, String target, long amount) {
    positive(amount);
    if (source.equals(target)) throw new IllegalArgumentException("a transfer needs two accounts");
    long from = get(source);
    long to = get(target);
    if (from < amount) return false;
    accounts.put(source, from - amount);
    accounts.put(target, to + amount);
    return true;
  }

  public synchronized long balance(String account) {
    return get(account);
  }

  public synchronized long total() {
    long sum = 0;
    for (long b : accounts.values()) sum += b;
    return sum;
  }
}
