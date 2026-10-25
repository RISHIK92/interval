import interval_jobs


def test_package_imports_from_src() -> None:
    assert interval_jobs.__file__ is not None
    assert "/src/interval_jobs/" in interval_jobs.__file__
