//! Parental control: turns the free-form certification string carried by a
//! movie's metadata into a minimum age, and decides whether the instance's
//! `max_content_age` lets it through.
//!
//! Certifications come from the metadata providers verbatim and are NOT
//! normalised on the way in: the same film is `PG-13` from one provider, `12`
//! from another, `FSK 16` from a third. Everything is matched here, at read
//! time, so no migration and no re-enrichment is needed for the setting to work
//! on an existing library.
//!
//! Only MOVIES carry `content_rating` in this module's schema — TV shows and
//! episodes have no such column — so a series is always "unrated" and is
//! governed by `block_unrated_content` alone.

use std::collections::HashMap;
use uuid::Uuid;

/// Minimum age a certification stands for, or `None` when the string is not
/// recognised (which the caller must treat as "unrated", never as "allowed").
///
/// Case- and space-insensitive. Handles the US (MPA / TV Parental Guidelines),
/// French (CNC), German (FSK) and bare-number forms, plus the `12+` / `16+`
/// suffix style used by several catalogues.
pub fn min_age_for(rating: &str) -> Option<u8> {
    let norm: String = rating
        .trim()
        .to_ascii_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    if norm.is_empty() {
        return None;
    }

    // Some providers prefix the country: "US:PG-13", "FR:-12", "DE:FSK16".
    let tail = norm.rsplit(':').next().unwrap_or("").to_string();
    let norm = if tail.is_empty() { norm } else { tail };

    // Named certifications first — they are unambiguous.
    match norm.as_str() {
        // United States — theatrical (MPA)
        "G" | "TV-G" | "TV-Y" | "TOUSPUBLICS" | "TOUTPUBLIC" | "U" | "UNIVERSAL" => return Some(0),
        "TV-Y7" | "TV-Y7-FV" => return Some(7),
        "PG" | "TV-PG" => return Some(8),
        "PG-13" | "PG13" | "TV-14" => return Some(13),
        "R" | "TV-MA" | "M" | "MA" => return Some(17),
        "NC-17" | "NC17" | "X" | "XXX" | "AO" => return Some(18),
        // No certification was assigned by the rating board: not a rating.
        "NR" | "UR" | "UNRATED" | "NOTRATED" | "NONE" | "N/A" => return None,
        _ => {}
    }

    // Prefixed / suffixed numeric forms: "FSK12", "-12", "12+", "12A", "12ANS".
    let digits: String = norm
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(char::is_ascii_digit)
        .collect();
    if digits.is_empty() {
        return None;
    }
    // "TV-14" style is handled above; anything else must be a plain age. A
    // 3-digit number is junk, not an age.
    if digits.len() > 2 {
        return None;
    }
    let age: u8 = digits.parse().ok()?;
    // Ages above 21 are not certifications (release years, runtimes, …).
    (age <= 21).then_some(age)
}

/// Whether an item may be played / listed for a NON-ADMIN user.
///
/// * `max_age == 0` — the restriction is disabled, everything passes.
/// * unknown or missing certification — governed by `block_unrated`.
/// * otherwise — the certification's minimum age must not exceed the ceiling.
pub fn is_allowed(rating: Option<&str>, max_age: u8, block_unrated: bool) -> bool {
    if max_age == 0 {
        return true;
    }
    match rating.map(str::trim).filter(|r| !r.is_empty()).and_then(min_age_for) {
        Some(min_age) => min_age <= max_age,
        None => !block_unrated,
    }
}

/// Certifications of the given movies, in one runtime query (never a macro: the
/// module ships a `.sqlx` offline cache that new macros would invalidate).
///
/// Ids that are not movies — TV episodes, for instance — are simply absent from
/// the map, which the caller reads as "unrated".
pub async fn ratings_for(
    db: &sqlx::PgPool,
    ids: &[Uuid],
) -> HashMap<Uuid, Option<String>> {
    if ids.is_empty() {
        return HashMap::new();
    }
    let rows = sqlx::query_as::<_, (Uuid, Option<String>)>(
        "SELECT id, content_rating FROM media.movies WHERE id = ANY($1)",
    )
    .bind(ids)
    .fetch_all(db)
    .await;

    match rows {
        Ok(rows) => rows.into_iter().collect(),
        Err(e) => {
            tracing::error!(error = %e, "Contrôle parental : lecture des classifications");
            // A failed read must not open the gate: an empty map makes every id
            // "unrated", which `block_unrated_content` then decides on.
            HashMap::new()
        }
    }
}

/// Certification of a single item, `None` when the id is not a movie.
pub async fn rating_of(db: &sqlx::PgPool, id: Uuid) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query_scalar::<_, Option<String>>(
        "SELECT content_rating FROM media.movies WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Contrôle parental : lecture de la classification");
        e
    })?;
    Ok(row.flatten())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn us_certifications_map_to_ages() {
        assert_eq!(min_age_for("G"), Some(0));
        assert_eq!(min_age_for("TV-Y7"), Some(7));
        assert_eq!(min_age_for("PG"), Some(8));
        assert_eq!(min_age_for("PG-13"), Some(13));
        assert_eq!(min_age_for("TV-14"), Some(13));
        assert_eq!(min_age_for("R"), Some(17));
        assert_eq!(min_age_for("NC-17"), Some(18));
    }

    #[test]
    fn french_and_german_forms_map_to_ages() {
        assert_eq!(min_age_for("Tous publics"), Some(0));
        assert_eq!(min_age_for("-10"), Some(10));
        assert_eq!(min_age_for("-12"), Some(12));
        assert_eq!(min_age_for("16"), Some(16));
        assert_eq!(min_age_for("-18"), Some(18));
        assert_eq!(min_age_for("FSK 12"), Some(12));
        assert_eq!(min_age_for("18+"), Some(18));
        assert_eq!(min_age_for("fr:-16"), Some(16));
    }

    #[test]
    fn unknown_and_empty_strings_are_not_ratings() {
        assert_eq!(min_age_for(""), None);
        assert_eq!(min_age_for("   "), None);
        assert_eq!(min_age_for("NR"), None);
        assert_eq!(min_age_for("Unrated"), None);
        assert_eq!(min_age_for("Approved"), None);
        // A release year is not an age.
        assert_eq!(min_age_for("1998"), None);
    }

    #[test]
    fn a_disabled_restriction_lets_everything_through() {
        assert!(is_allowed(Some("NC-17"), 0, true));
        assert!(is_allowed(None, 0, true));
    }

    #[test]
    fn unrated_content_follows_the_block_unrated_switch() {
        assert!(is_allowed(None, 12, false));
        assert!(!is_allowed(None, 12, true));
        assert!(is_allowed(Some("   "), 12, false));
        assert!(!is_allowed(Some("Approved"), 12, true));
    }

    #[test]
    fn a_ceiling_admits_lighter_certifications_and_refuses_heavier_ones() {
        assert!(!is_allowed(Some("PG-13"), 12, false));
        assert!(is_allowed(Some("PG-13"), 16, false));
        assert!(is_allowed(Some("PG"), 12, true));
        assert!(!is_allowed(Some("R"), 16, false));
        assert!(is_allowed(Some("-18"), 18, false));
    }
}
