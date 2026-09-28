import pytest

from mtnproj.grades import discipline, grade_key

ROCK_ORDER = [
    "4th", "Easy 5th", "5.4", "5.8-", "5.8", "5.8+", "5.9", "5.10a", "5.10a/b",
    "5.10b", "5.10", "5.10c", "5.10+", "5.10d", "5.11a", "5.11-", "5.11b", "5.12c", "5.15d",
]


def test_yds_ordering():
    keys = [grade_key(g) for g in ROCK_ORDER]
    assert keys == sorted(keys), list(zip(ROCK_ORDER, keys))


def test_boulder_ordering():
    grades = ["VB", "V0", "V0+", "V1", "V4-5", "V5", "V10", "V16"]
    keys = [grade_key(g, ["Boulder"]) for g in grades]
    assert keys == sorted(keys)


def test_aid_suffix_does_not_change_free_grade():
    # "5.9 C2": the C belongs to the aid grade, not to "5.9c".
    assert grade_key("5.9 C2") == grade_key("5.9")


def test_protection_rating_ignored():
    assert grade_key("5.12a R") == grade_key("5.12a")


@pytest.mark.parametrize(
    ("grade", "types", "expected"),
    [
        ("5.10a", ["Sport"], "rock"),
        ("V3", ["Boulder"], "boulder"),
        ("WI4+", ["Ice"], "ice"),
        ("M6", ["Mixed"], "mixed"),
        ("A2", ["Aid"], "aid"),
        ("Easy Snow", ["Snow"], "snow"),
    ],
)
def test_disciplines(grade, types, expected):
    assert discipline(grade_key(grade, types)) == expected


def test_unknown():
    assert grade_key(None) is None
    assert grade_key("???") is None
