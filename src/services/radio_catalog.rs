//! Curated catalogue of ~100 popular internet radio stations, seeded as builtin
//! stations at startup (idempotent upsert keyed by `slug`).
//!
//! Stream URLs are best-effort public endpoints (Icecast/Shoutcast/HLS-free MP3
//! or AAC). They can drift over time; users can always add their own custom
//! stations or use the discovery search (Radio Browser) to find current URLs.

use sqlx::PgPool;

pub struct RadioSeed {
    pub slug:       &'static str,
    pub name:       &'static str,
    pub stream_url: &'static str,
    pub homepage:   &'static str,
    pub tags:       &'static [&'static str],
    pub country:    &'static str,
    pub language:   &'static str,
    pub codec:      &'static str,
    pub bitrate:    i32,
}

#[allow(clippy::too_many_arguments)]
const fn r(
    slug: &'static str, name: &'static str, stream_url: &'static str, homepage: &'static str,
    tags: &'static [&'static str], country: &'static str, language: &'static str,
    codec: &'static str, bitrate: i32,
) -> RadioSeed {
    RadioSeed { slug, name, stream_url, homepage, tags, country, language, codec, bitrate }
}

pub fn catalog() -> Vec<RadioSeed> {
    vec![
        // ── France — Radio France (service public) ──
        r("franceinter", "France Inter", "https://icecast.radiofrance.fr/franceinter-midfi.mp3", "https://www.radiofrance.fr/franceinter", &["généraliste", "talk", "actualité"], "France", "fr", "MP3", 128),
        r("franceinfo", "franceinfo", "https://icecast.radiofrance.fr/franceinfo-midfi.mp3", "https://www.radiofrance.fr/franceinfo", &["actualité", "talk", "info"], "France", "fr", "MP3", 128),
        r("franceculture", "France Culture", "https://icecast.radiofrance.fr/franceculture-midfi.mp3", "https://www.radiofrance.fr/franceculture", &["culture", "talk"], "France", "fr", "MP3", 128),
        r("francemusique", "France Musique", "https://icecast.radiofrance.fr/francemusique-midfi.mp3", "https://www.radiofrance.fr/francemusique", &["classique", "jazz"], "France", "fr", "MP3", 128),
        r("fip", "FIP", "https://icecast.radiofrance.fr/fip-midfi.mp3", "https://www.radiofrance.fr/fip", &["éclectique", "découverte"], "France", "fr", "MP3", 128),
        r("fiprock", "FIP Rock", "https://icecast.radiofrance.fr/fiprock-midfi.mp3", "https://www.radiofrance.fr/fip", &["rock"], "France", "fr", "MP3", 128),
        r("fipjazz", "FIP Jazz", "https://icecast.radiofrance.fr/fipjazz-midfi.mp3", "https://www.radiofrance.fr/fip", &["jazz"], "France", "fr", "MP3", 128),
        r("fipgroove", "FIP Groove", "https://icecast.radiofrance.fr/fipgroove-midfi.mp3", "https://www.radiofrance.fr/fip", &["groove", "funk", "soul"], "France", "fr", "MP3", 128),
        r("fipworld", "FIP Monde", "https://icecast.radiofrance.fr/fipworld-midfi.mp3", "https://www.radiofrance.fr/fip", &["world", "monde"], "France", "fr", "MP3", 128),
        r("fipreggae", "FIP Reggae", "https://icecast.radiofrance.fr/fipreggae-midfi.mp3", "https://www.radiofrance.fr/fip", &["reggae"], "France", "fr", "MP3", 128),
        r("fipelectro", "FIP Electro", "https://icecast.radiofrance.fr/fipelectro-midfi.mp3", "https://www.radiofrance.fr/fip", &["électro"], "France", "fr", "MP3", 128),
        r("fipnouveautes", "FIP Nouveautés", "https://icecast.radiofrance.fr/fipnouveautes-midfi.mp3", "https://www.radiofrance.fr/fip", &["nouveautés", "pop"], "France", "fr", "MP3", 128),
        r("fippop", "FIP Pop", "https://icecast.radiofrance.fr/fippop-midfi.mp3", "https://www.radiofrance.fr/fip", &["pop"], "France", "fr", "MP3", 128),
        r("fiphiphop", "FIP Hip-Hop", "https://icecast.radiofrance.fr/fiphiphop-midfi.mp3", "https://www.radiofrance.fr/fip", &["hip-hop", "rap"], "France", "fr", "MP3", 128),
        r("mouv", "Mouv'", "https://icecast.radiofrance.fr/mouv-midfi.mp3", "https://www.radiofrance.fr/mouv", &["hip-hop", "rap", "jeune"], "France", "fr", "MP3", 128),
        r("mouvrap", "Mouv' Rap US", "https://icecast.radiofrance.fr/mouvrapus-midfi.mp3", "https://www.radiofrance.fr/mouv", &["rap", "hip-hop"], "France", "fr", "MP3", 128),

        // ── France — NRJ Group ──
        r("nrj", "NRJ", "https://cdn.nrjaudio.fm/audio1/fr/30001/mp3_128.mp3", "https://www.nrj.fr", &["pop", "hits", "dance"], "France", "fr", "MP3", 128),
        r("cheriefm", "Chérie FM", "https://cdn.nrjaudio.fm/audio1/fr/30201/mp3_128.mp3", "https://www.cheriefm.fr", &["pop", "love songs"], "France", "fr", "MP3", 128),
        r("nostalgie", "Nostalgie", "https://cdn.nrjaudio.fm/audio1/fr/30601/mp3_128.mp3", "https://www.nostalgie.fr", &["oldies", "années 80"], "France", "fr", "MP3", 128),
        r("rireetchansons", "Rire & Chansons", "https://cdn.nrjaudio.fm/audio1/fr/30401/mp3_128.mp3", "https://www.rireetchansons.fr", &["humour", "comédie"], "France", "fr", "MP3", 128),

        // ── France — RTL Group ──
        r("rtl", "RTL", "https://streaming.radio.rtl.fr/rtl-1-44-128", "https://www.rtl.fr", &["généraliste", "talk"], "France", "fr", "MP3", 128),
        r("rtl2", "RTL2", "https://streaming.radio.rtl.fr/rtl2-1-44-128", "https://www.rtl2.fr", &["pop rock"], "France", "fr", "MP3", 128),
        r("funradio", "Fun Radio", "https://streaming.radio.rtl.fr/fun-radio-1-44-128", "https://www.funradio.fr", &["dance", "électro"], "France", "fr", "MP3", 128),

        // ── France — Indépendantes ──
        r("europe1", "Europe 1", "https://europe1.lmn.fm/europe1.mp3", "https://www.europe1.fr", &["généraliste", "talk"], "France", "fr", "MP3", 128),
        r("rmc", "RMC", "https://audio.bfmtv.com/rmcradio_128.mp3", "https://rmc.bfmtv.com", &["talk", "sport", "actualité"], "France", "fr", "MP3", 128),
        r("skyrock", "Skyrock", "http://icecast.skyrock.net/s/natio_mp3_128k", "https://www.skyrock.fm", &["rap", "hip-hop"], "France", "fr", "MP3", 128),
        r("radionova", "Radio Nova", "https://novazz.ice.infomaniak.ch/novazz-128.mp3", "https://www.nova.fr", &["éclectique", "découverte"], "France", "fr", "MP3", 128),
        r("radioclassique", "Radio Classique", "https://radioclassique.ice.infomaniak.ch/radioclassique-high.mp3", "https://www.radioclassique.fr", &["classique"], "France", "fr", "MP3", 128),
        r("tsfjazz", "TSF Jazz", "https://tsfjazz.ice.infomaniak.ch/tsfjazz-high.mp3", "https://www.tsfjazz.com", &["jazz"], "France", "fr", "MP3", 128),
        r("jazzradio", "Jazz Radio", "https://jazzradio.ice.infomaniak.ch/jazzradio-high.mp3", "https://www.jazzradio.fr", &["jazz", "soul"], "France", "fr", "MP3", 128),
        r("generations", "Générations", "https://generations.ice.infomaniak.ch/generations-128.mp3", "https://www.generations.fr", &["rap", "hip-hop"], "France", "fr", "MP3", 128),
        r("ouifm", "OÜI FM", "https://ouifm.ice.infomaniak.ch/ouifm-high.mp3", "https://www.ouifm.fr", &["rock"], "France", "fr", "MP3", 128),
        r("radiofg", "Radio FG", "https://radiofg.impek.com/fg", "https://www.radiofg.com", &["électro", "house", "dance"], "France", "fr", "MP3", 128),
        r("radiomeuh", "Radio Meuh", "https://radiomeuh.ice.infomaniak.ch/radiomeuh-128.mp3", "https://www.radiomeuh.com", &["éclectique", "indie"], "France", "fr", "MP3", 128),
        r("swigg", "Swigg", "https://swigg.ice.infomaniak.ch/swigg-high.mp3", "https://www.swigg.fr", &["urban", "hip-hop"], "France", "fr", "MP3", 128),
        r("voltage", "Voltage", "https://start-staticvoltage.ice.infomaniak.ch/start-staticvoltage-high.mp3", "https://www.voltage.fr", &["dance", "hits"], "France", "fr", "MP3", 128),
        r("ado", "Ado FM", "https://start-adofm.ice.infomaniak.ch/start-adofm.mp3", "https://www.ado.fr", &["pop", "dance"], "France", "fr", "MP3", 128),

        // ── SomaFM (États-Unis, sans pub, très fiable) ──
        r("soma-groovesalad", "SomaFM Groove Salad", "https://ice1.somafm.com/groovesalad-128-mp3", "https://somafm.com/groovesalad/", &["ambient", "chillout", "downtempo"], "USA", "en", "MP3", 128),
        r("soma-dronezone", "SomaFM Drone Zone", "https://ice1.somafm.com/dronezone-128-mp3", "https://somafm.com/dronezone/", &["ambient", "atmospheric"], "USA", "en", "MP3", 128),
        r("soma-lush", "SomaFM Lush", "https://ice1.somafm.com/lush-128-mp3", "https://somafm.com/lush/", &["vocal", "chill"], "USA", "en", "MP3", 128),
        r("soma-indiepop", "SomaFM Indie Pop Rocks", "https://ice1.somafm.com/indiepop-128-mp3", "https://somafm.com/indiepop/", &["indie", "pop"], "USA", "en", "MP3", 128),
        r("soma-secretagent", "SomaFM Secret Agent", "https://ice1.somafm.com/secretagent-128-mp3", "https://somafm.com/secretagent/", &["lounge", "downtempo"], "USA", "en", "MP3", 128),
        r("soma-defcon", "SomaFM DEF CON Radio", "https://ice1.somafm.com/defcon-128-mp3", "https://somafm.com/defcon/", &["électro", "techno"], "USA", "en", "MP3", 128),
        r("soma-spacestation", "SomaFM Space Station Soma", "https://ice1.somafm.com/spacestation-128-mp3", "https://somafm.com/spacestation/", &["ambient", "space"], "USA", "en", "MP3", 128),
        r("soma-beatblender", "SomaFM Beat Blender", "https://ice1.somafm.com/beatblender-128-mp3", "https://somafm.com/beatblender/", &["deep house", "downtempo"], "USA", "en", "MP3", 128),
        r("soma-bootliquor", "SomaFM Boot Liquor", "https://ice1.somafm.com/bootliquor-128-mp3", "https://somafm.com/bootliquor/", &["americana", "country"], "USA", "en", "MP3", 128),
        r("soma-sonicuniverse", "SomaFM Sonic Universe", "https://ice1.somafm.com/sonicuniverse-128-mp3", "https://somafm.com/sonicuniverse/", &["jazz", "avant-garde"], "USA", "en", "MP3", 128),
        r("soma-thetrip", "SomaFM The Trip", "https://ice1.somafm.com/thetrip-128-mp3", "https://somafm.com/thetrip/", &["progressive", "house"], "USA", "en", "MP3", 128),
        r("soma-u80s", "SomaFM Underground 80s", "https://ice1.somafm.com/u80s-128-mp3", "https://somafm.com/u80s/", &["années 80", "synthpop"], "USA", "en", "MP3", 128),
        r("soma-poptron", "SomaFM PopTron", "https://ice1.somafm.com/poptron-128-mp3", "https://somafm.com/poptron/", &["électro pop"], "USA", "en", "MP3", 128),
        r("soma-fluid", "SomaFM Fluid", "https://ice1.somafm.com/fluid-128-mp3", "https://somafm.com/fluid/", &["hip-hop", "trip-hop"], "USA", "en", "MP3", 128),
        r("soma-seventies", "SomaFM Left Coast 70s", "https://ice1.somafm.com/seventies-128-mp3", "https://somafm.com/seventies/", &["années 70", "rock"], "USA", "en", "MP3", 128),
        r("soma-metal", "SomaFM Metal Detector", "https://ice1.somafm.com/metal-128-mp3", "https://somafm.com/metal/", &["metal"], "USA", "en", "MP3", 128),
        r("soma-folkfwd", "SomaFM Folk Forward", "https://ice1.somafm.com/folkfwd-128-mp3", "https://somafm.com/folkfwd/", &["folk", "indie"], "USA", "en", "MP3", 128),
        r("soma-7soul", "SomaFM Seven Inch Soul", "https://ice1.somafm.com/7soul-128-mp3", "https://somafm.com/7soul/", &["soul", "vintage"], "USA", "en", "MP3", 128),
        r("soma-illstreet", "SomaFM Illinois Street Lounge", "https://ice1.somafm.com/illstreet-128-mp3", "https://somafm.com/illstreet/", &["lounge", "exotica"], "USA", "en", "MP3", 128),
        r("soma-suburbsofgoa", "SomaFM Suburbs of Goa", "https://ice1.somafm.com/suburbsofgoa-128-mp3", "https://somafm.com/suburbsofgoa/", &["world", "psy"], "USA", "en", "MP3", 128),

        // ── Radio Paradise (États-Unis) ──
        r("rp-main", "Radio Paradise Main Mix", "https://stream.radioparadise.com/mp3-128", "https://radioparadise.com", &["éclectique", "rock"], "USA", "en", "MP3", 128),
        r("rp-mellow", "Radio Paradise Mellow", "https://stream.radioparadise.com/mellow-128", "https://radioparadise.com", &["chill", "mellow"], "USA", "en", "MP3", 128),
        r("rp-rock", "Radio Paradise Rock", "https://stream.radioparadise.com/rock-128", "https://radioparadise.com", &["rock"], "USA", "en", "MP3", 128),
        r("rp-global", "Radio Paradise Global", "https://stream.radioparadise.com/global-128", "https://radioparadise.com", &["world", "global"], "USA", "en", "MP3", 128),

        // ── Public / indé États-Unis ──
        r("kexp", "KEXP Seattle", "https://kexp-mp3-128.streamguys1.com/kexp128.mp3", "https://www.kexp.org", &["indie", "alternatif"], "USA", "en", "MP3", 128),
        r("kcrw", "KCRW Eclectic24", "https://kcrw.streamguys1.com/kcrw_192k_mp3_e24", "https://www.kcrw.com", &["éclectique", "indie"], "USA", "en", "MP3", 192),
        r("wfmu", "WFMU", "https://stream0.wfmu.org/freeform-128k", "https://wfmu.org", &["freeform", "indie"], "USA", "en", "MP3", 128),
        r("wwoz", "WWOZ New Orleans", "https://wwoz-sc.streamguys1.com/wwoz-hi.mp3", "https://www.wwoz.org", &["jazz", "blues"], "USA", "en", "MP3", 128),

        // ── Jazz / Classique (international) ──
        r("jazz24", "Jazz24", "https://live.wostreaming.net/direct/ppm-jazz24mp3-ibc1", "https://www.jazz24.org", &["jazz"], "USA", "en", "MP3", 128),
        r("linn-jazz", "Linn Jazz", "http://radio.linn.co.uk:8003/autodj", "https://www.linn.co.uk", &["jazz"], "Royaume-Uni", "en", "MP3", 320),
        r("linn-classical", "Linn Classical", "http://radio.linn.co.uk:8004/autodj", "https://www.linn.co.uk", &["classique"], "Royaume-Uni", "en", "MP3", 320),
        r("linn-radio", "Linn Radio", "http://radio.linn.co.uk:8000/autodj", "https://www.linn.co.uk", &["éclectique"], "Royaume-Uni", "en", "MP3", 320),
        r("venice-classic", "Venice Classic Radio", "https://uk2.streamingpulse.com/ssl/vcr1", "https://www.veniceclassicradio.eu", &["classique", "baroque"], "Italie", "it", "MP3", 128),

        // ── FluxFM / Allemagne ──
        r("fluxfm", "FluxFM", "https://streams.fluxfm.de/live/mp3-320/", "https://www.fluxfm.de", &["indie", "alternatif"], "Allemagne", "de", "MP3", 320),
        r("fluxfm-chillhop", "FluxFM Chillhop", "https://streams.fluxfm.de/chillhop/mp3-320/", "https://www.fluxfm.de", &["chillhop", "lo-fi"], "Allemagne", "de", "MP3", 320),
        r("fluxfm-hiphop", "FluxFM Boom Bap", "https://streams.fluxfm.de/boombap/mp3-320/", "https://www.fluxfm.de", &["hip-hop"], "Allemagne", "de", "MP3", 320),
        r("byte-fm", "ByteFM", "https://www.byte.fm/stream/bytefm.mp3", "https://www.byte.fm", &["indie", "éclectique"], "Allemagne", "de", "MP3", 128),

        // ── Royaume-Uni / divers ──
        r("nts1", "NTS Radio 1", "https://stream-relay-geo.ntslive.net/stream", "https://www.nts.live", &["underground", "éclectique"], "Royaume-Uni", "en", "MP3", 128),
        r("nts2", "NTS Radio 2", "https://stream-relay-geo.ntslive.net/stream2", "https://www.nts.live", &["underground", "éclectique"], "Royaume-Uni", "en", "MP3", 128),

        // ── Lo-fi / chill / focus ──
        r("chillhop", "Chillhop Radio", "https://streams.fluxfm.de/Chillhop/mp3-128/audio/", "https://chillhop.com", &["lo-fi", "chillhop", "focus"], "International", "en", "MP3", 128),

        // ── 181.FM (États-Unis, multi-genres) ──
        r("181-energy", "181.FM Energy 98 (Dance)", "http://listen.181fm.com/181-energy98_128k.mp3", "https://www.181.fm", &["dance", "EDM"], "USA", "en", "MP3", 128),
        r("181-thebeat", "181.FM The Beat (Hip-Hop)", "http://listen.181fm.com/181-beat_128k.mp3", "https://www.181.fm", &["hip-hop", "rap"], "USA", "en", "MP3", 128),
        r("181-90s", "181.FM Lite 90s", "http://listen.181fm.com/181-90slite_128k.mp3", "https://www.181.fm", &["années 90"], "USA", "en", "MP3", 128),
        r("181-80s", "181.FM Awesome 80s", "http://listen.181fm.com/181-awesome80s_128k.mp3", "https://www.181.fm", &["années 80"], "USA", "en", "MP3", 128),
        r("181-classichits", "181.FM Classic Hits", "http://listen.181fm.com/181-greatoldies_128k.mp3", "https://www.181.fm", &["oldies", "classic hits"], "USA", "en", "MP3", 128),
        r("181-country", "181.FM Real Country", "http://listen.181fm.com/181-realcountry_128k.mp3", "https://www.181.fm", &["country"], "USA", "en", "MP3", 128),
        r("181-classical", "181.FM Classical Guitar", "http://listen.181fm.com/181-classicalguitar_128k.mp3", "https://www.181.fm", &["classique", "guitare"], "USA", "en", "MP3", 128),
        r("181-rock", "181.FM Rock 181", "http://listen.181fm.com/181-rock_128k.mp3", "https://www.181.fm", &["rock"], "USA", "en", "MP3", 128),
        r("181-blues", "181.FM True Blues", "http://listen.181fm.com/181-blues_128k.mp3", "https://www.181.fm", &["blues"], "USA", "en", "MP3", 128),
        r("181-reggae", "181.FM Reggae Roots", "http://listen.181fm.com/181-reggae_128k.mp3", "https://www.181.fm", &["reggae"], "USA", "en", "MP3", 128),
        r("181-chilled", "181.FM Chilled Out", "http://listen.181fm.com/181-chilled_128k.mp3", "https://www.181.fm", &["chillout", "ambient"], "USA", "en", "MP3", 128),
        r("181-xmas", "181.FM Christmas", "http://listen.181fm.com/181-christmas_128k.mp3", "https://www.181.fm", &["noël", "fêtes"], "USA", "en", "MP3", 128),
        r("181-salsa", "181.FM Salsa", "http://listen.181fm.com/181-salsa_128k.mp3", "https://www.181.fm", &["salsa", "latino"], "USA", "en", "MP3", 128),
        r("181-jammin", "181.FM Jammin' Country", "http://listen.181fm.com/181-jammincountry_128k.mp3", "https://www.181.fm", &["country"], "USA", "en", "MP3", 128),

        // ── Belgique / Suisse / Canada / Québec ──
        r("classic21", "Classic 21 (RTBF)", "https://radios.rtbf.be/classic21-128.mp3", "https://www.rtbf.be/classic21", &["rock", "classics"], "Belgique", "fr", "MP3", 128),
        r("purefm", "Pure (RTBF)", "https://radios.rtbf.be/pure-128.mp3", "https://www.rtbf.be/pure", &["pop", "électro"], "Belgique", "fr", "MP3", 128),
        r("lapremiere", "La Première (RTBF)", "https://radios.rtbf.be/lapremiere-128.mp3", "https://www.rtbf.be/lapremiere", &["généraliste", "talk"], "Belgique", "fr", "MP3", 128),
        r("musiq3", "Musiq3 (RTBF)", "https://radios.rtbf.be/musiq3-128.mp3", "https://www.rtbf.be/musiq3", &["classique"], "Belgique", "fr", "MP3", 128),
        r("couleur3", "Couleur 3 (RTS)", "http://stream.srg-ssr.ch/m/couleur3/mp3_128", "https://www.rts.ch/couleur3", &["alternatif", "électro"], "Suisse", "fr", "MP3", 128),
        r("optionmusique", "Option Musique (RTS)", "http://stream.srg-ssr.ch/m/option-musique/mp3_128", "https://www.rts.ch", &["variété", "chanson"], "Suisse", "fr", "MP3", 128),
        r("icipremiere", "ICI Première (Radio-Canada)", "https://rcavliveaudio.akamaized.net/hls/live/2006635/P-2QMTL0_MTL/master.m3u8", "https://ici.radio-canada.ca", &["généraliste", "talk"], "Canada", "fr", "AAC", 96),

        // ── International — divers pays ──
        r("rne-clasica", "Radio Clásica (RNE)", "https://crtvg.rtve.es/recursos/radio/radioclasica.mp3", "https://www.rtve.es", &["classique"], "Espagne", "es", "MP3", 128),
        r("rai-radio1", "Rai Radio 1", "https://icestreaming.rai.it/1.mp3", "https://www.raiplaysound.it", &["généraliste", "talk"], "Italie", "it", "MP3", 128),
        r("rai-radio2", "Rai Radio 2", "https://icestreaming.rai.it/2.mp3", "https://www.raiplaysound.it", &["pop", "variété"], "Italie", "it", "MP3", 128),
        r("rai-radio3", "Rai Radio 3", "https://icestreaming.rai.it/3.mp3", "https://www.raiplaysound.it", &["classique", "culture"], "Italie", "it", "MP3", 128),
        r("antenne-bayern", "Antenne Bayern", "https://stream.antenne.de/antenne", "https://www.antenne.de", &["pop", "hits"], "Allemagne", "de", "MP3", 128),
        r("swr3", "SWR3", "https://liveradio.swr.de/sw282p3/swr3/play.mp3", "https://www.swr3.de", &["pop", "rock"], "Allemagne", "de", "MP3", 128),
        r("nporadio2", "NPO Radio 2", "https://icecast.omroep.nl/radio2-bb-mp3", "https://www.nporadio2.nl", &["pop", "variété"], "Pays-Bas", "nl", "MP3", 128),
        r("triplej", "triple j (ABC)", "https://live-radio01.mediahubaustralia.com/2TJW/mp3/", "https://www.abc.net.au/triplej", &["alternatif", "indie"], "Australie", "en", "MP3", 128),
        r("kpop-181", "Big R Radio K-Pop", "http://bigrradio.cdnstream1.com/5147_128", "https://bigrradio.com", &["k-pop"], "International", "ko", "MP3", 128),

        // ── Électro / dance internationales ──
        r("ibiza-global", "Ibiza Global Radio", "https://ibizaglobalradio.streaming-pro.com:8024/stream", "https://www.ibizaglobalradio.com", &["house", "balearic", "électro"], "Espagne", "es", "MP3", 128),
        r("frisky", "Frisky Radio", "https://stream.friskyradio.com/frisky_mp3_hi", "https://www.friskyradio.com", &["house", "techno", "trance"], "International", "en", "MP3", 128),
        r("proton", "Proton Radio", "https://shoutcast.protonradio.com/;", "https://www.protonradio.com", &["progressive", "deep house"], "International", "en", "MP3", 128),

        // ── Ambient / focus / nature ──
        r("epicrock", "Epic Rock Radio", "https://eu10.fastcast4u.com/proxy/sonixfm?mp=/1", "https://epicrockradio.com", &["rock", "epic"], "International", "en", "MP3", 128),
        r("classicalkdfc", "Classical KDFC", "https://19293.live.streamtheworld.com/KDFCFMAAC.aac", "https://www.kdfc.com", &["classique"], "USA", "en", "AAC", 96),
    ]
}

/// Idempotently insert/refresh the builtin radio catalogue (keyed by `slug`).
pub async fn seed(db: &PgPool) {
    let items = catalog();
    let count = items.len();
    for s in items {
        let tags: Vec<String> = s.tags.iter().map(|t| t.to_string()).collect();
        let res = sqlx::query(
            r#"INSERT INTO media.radio_stations
                 (name, stream_url, homepage, favicon, tags, country, language, codec, bitrate, is_builtin, slug)
               VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, TRUE, $9)
               ON CONFLICT (slug) DO UPDATE SET
                 name = EXCLUDED.name, stream_url = EXCLUDED.stream_url, homepage = EXCLUDED.homepage,
                 tags = EXCLUDED.tags, country = EXCLUDED.country, language = EXCLUDED.language,
                 codec = EXCLUDED.codec, bitrate = EXCLUDED.bitrate, updated_at = NOW()"#,
        )
        .bind(s.name)
        .bind(s.stream_url)
        .bind(s.homepage)
        .bind(&tags)
        .bind(s.country)
        .bind(s.language)
        .bind(s.codec)
        .bind(s.bitrate)
        .bind(s.slug)
        .execute(db)
        .await;
        if let Err(e) = res {
            tracing::warn!(error = %e, slug = %s.slug, "seed radio station");
        }
    }
    tracing::info!(count, "Catalogue radio builtin synchronisé");
}
