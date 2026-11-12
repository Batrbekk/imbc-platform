import { defineDictionary } from "@/prototype/i18n";

export const ndaTexts = defineDictionary({
  en: {
    title: "NDA versions",
    description: "The NDA covers the detailed demand forecast, the STR and the KTRE.",
    effectTitle: "What publishing a new version does",
    effect:
      "As soon as a new version is published, the demand forecast and the STR and KTRE files close for every manufacturer until it accepts the new version. Acceptance is the same tick as at registration; the platform records the time, the version and the IP address.",
    publish: "Publish new version",
    publishTitle: "Publish a new NDA version",
    publishConfirm: "Publish",
    version: "Version number",
    versionTaken: "This version already exists.",
    summary: "What changed",
    published: "Published NDA version {version}",
    noVersions: "No NDA version has been published yet.",
  },
  ru: {
    title: "Версии NDA",
    description: "NDA покрывает подробный прогноз спроса, STR и KTRE.",
    effectTitle: "Что делает публикация новой версии",
    effect:
      "Сразу после публикации новой версии прогноз спроса и файлы STR и KTRE закрываются для каждого производителя, пока он не примет новую версию. Принятие — та же отметка, что при регистрации; платформа записывает время, версию и IP-адрес.",
    publish: "Опубликовать новую версию",
    publishTitle: "Новая версия NDA",
    publishConfirm: "Опубликовать",
    version: "Номер версии",
    versionTaken: "Такая версия уже есть.",
    summary: "Что изменилось",
    published: "Опубликована версия NDA {version}",
    noVersions: "Версий NDA ещё не опубликовано.",
  },
  kk: {
    title: "NDA нұсқалары",
    description: "NDA толық сұраныс болжамын, STR және KTRE-ні қамтиды.",
    effectTitle: "Жаңа нұсқаны жариялау не істейді",
    effect:
      "Жаңа нұсқа жарияланғаннан кейін сұраныс болжамы мен STR және KTRE файлдары әр өндіруші жаңа нұсқаны қабылдағанша жабылады. Қабылдау — тіркелудегідей белгі; платформа уақытты, нұсқаны және IP-мекенжайды жазады.",
    publish: "Жаңа нұсқаны жариялау",
    publishTitle: "NDA жаңа нұсқасы",
    publishConfirm: "Жариялау",
    version: "Нұсқа нөмірі",
    versionTaken: "Мұндай нұсқа бар.",
    summary: "Не өзгерді",
    published: "NDA {version} нұсқасы жарияланды",
    noVersions: "NDA нұсқалары әлі жарияланбаған.",
  },
});
