import { defineDictionary } from "@/prototype/i18n";

export const forecastTexts = defineDictionary({
  en: {
    title: "Demand forecast",
    description:
      "IMBC prepares and approves the lines before import. Manufacturers see only the version published last, once verified and with the current NDA accepted.",
    importTitle: "Import a forecast file",
    importHint:
      "XLSX with the fixed column set: TN VED code, commodity group, commodity type, description, unit of measure, total quantity. Missing columns stop the import; extra columns, including per-operator and FPAL columns, are ignored and never published. Faulty rows do not stop the import.",
    importLabel: "Forecast file (XLSX)",
    simulation: "Simulation: the prototype does not read the file; rows and problems come from the demo data.",
    notXlsx: "Only an XLSX file is imported. The file was not imported.",
    imported: "Imported {file}: {rows} rows, {problems} with problems",
    importedNotice: "{file} is imported and not published yet. Check the problem report, then publish.",
    versions: "Versions",
    publishTitle: "Publish {file}?",
    publishDescription:
      "The version becomes visible to manufacturers and replaces the previous one for them. IMBC keeps earlier versions. In this prototype, rows from the problem report are not shown to manufacturers.",
    published: "Published the demand forecast {file}",
  },
  ru: {
    title: "Прогноз спроса",
    description:
      "IMBC готовит и утверждает строки до импорта. Производители видят только опубликованную последней версию — после верификации и принятия текущей NDA.",
    importTitle: "Импорт файла прогноза",
    importHint:
      "XLSX с фиксированным набором колонок: код ТН ВЭД, товарная группа, тип товара, описание, единица измерения, общее количество. Нет колонки — импорт останавливается; лишние колонки, в том числе по операторам и FPAL, пропускаются и не публикуются. Строки с ошибками импорт не останавливают.",
    importLabel: "Файл прогноза (XLSX)",
    simulation: "Имитация: прототип не читает файл; строки и ошибки берутся из демо-данных.",
    notXlsx: "Импортируется только файл XLSX. Файл не импортирован.",
    imported: "Импортирован {file}: строк {rows}, с ошибками {problems}",
    importedNotice: "{file} импортирован и ещё не опубликован. Проверьте отчёт об ошибках и опубликуйте.",
    versions: "Версии",
    publishTitle: "Опубликовать {file}?",
    publishDescription:
      "Версия станет видна производителям и заменит для них прежнюю. Прежние версии IMBC хранит. В прототипе строки из отчёта об ошибках производителям не показываются.",
    published: "Опубликован прогноз спроса {file}",
  },
  kk: {
    title: "Сұраныс болжамы",
    description:
      "IMBC жолдарды импортқа дейін дайындап, бекітеді. Өндірушілер тек соңғы жарияланған нұсқаны көреді — верификациядан және ағымдағы NDA қабылданғаннан кейін.",
    importTitle: "Болжам файлын импорттау",
    importHint:
      "Тұрақты бағандары бар XLSX: СЭҚ ТН коды, тауар тобы, тауар түрі, сипаттама, өлшем бірлігі, жалпы саны. Баған жоқ болса, импорт тоқтайды; артық бағандар, оның ішінде операторлар мен FPAL бағандары, өткізіліп, жарияланбайды. Қатесі бар жолдар импортты тоқтатпайды.",
    importLabel: "Болжам файлы (XLSX)",
    simulation: "Имитация: прототип файлды оқымайды; жолдар мен қателер демо-деректерден алынады.",
    notXlsx: "Тек XLSX файлы импортталады. Файл импортталмады.",
    imported: "{file} импортталды: {rows} жол, қатесі барлары {problems}",
    importedNotice: "{file} импортталды, әлі жарияланбаған. Қателер есебін тексеріп, жариялаңыз.",
    versions: "Нұсқалар",
    publishTitle: "{file} жариялау керек пе?",
    publishDescription:
      "Нұсқа өндірушілерге көрінеді және олар үшін бұрынғысын ауыстырады. IMBC бұрынғы нұсқаларды сақтайды. Прототипте қателер есебіндегі жолдар өндірушілерге көрсетілмейді.",
    published: "Сұраныс болжамы жарияланды: {file}",
  },
});
