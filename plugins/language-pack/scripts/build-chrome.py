#!/usr/bin/env python3
"""Write chrome-dicts.json (sidebar / settings / workspace / common / model)."""

import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
cat = json.loads((root / "catalog.json").read_text(encoding="utf-8"))

# lang -> ns -> key -> text. Only chrome namespaces; conversation/chat wait for full pack.
chrome = {
    "zh-Hant": {},
    "ja": {},
    "ko": {},
    "fr": {},
    "es": {},
}

def put(ns, key, **langs):
    for lang, text in langs.items():
        chrome[lang].setdefault(ns, {})[key] = text

# common
for key, zh_hant, ja, ko, fr, es in [
    ("ok", "確定", "OK", "확인", "OK", "Aceptar"),
    ("cancel", "取消", "キャンセル", "취소", "Annuler", "Cancelar"),
    ("close", "關閉", "閉じる", "닫기", "Fermer", "Cerrar"),
    ("copy", "複製", "コピー", "복사", "Copier", "Copiar"),
    ("copied", "已複製", "コピーしました", "복사됨", "Copié", "Copiado"),
    ("copy.failed", "複製失敗", "コピーに失敗しました", "복사 실패", "Échec de la copie", "Error al copiar"),
    ("copy.value", "複製值", "値をコピー", "값 복사", "Copier la valeur", "Copiar valor"),
    ("copy.json", "複製 JSON", "JSON をコピー", "JSON 복사", "Copier le JSON", "Copiar JSON"),
    ("copy.path", "複製屬性路徑", "パスをコピー", "속성 경로 복사", "Copier le chemin", "Copiar ruta"),
    ("copy.prettyJson", "複製格式化 JSON", "整形 JSON をコピー", "보기 좋은 JSON 복사", "Copier le JSON formaté", "Copiar JSON formateado"),
    ("copy.compactJson", "複製緊湊 JSON", "コンパクト JSON をコピー", "압축 JSON 복사", "Copier le JSON compact", "Copiar JSON compacto"),
    ("copy.optionsHint", "{action}；右鍵可選擇複製方式", "{action}。右クリックでコピー方法を選択", "{action}. 오른쪽 클릭으로 복사 방식 선택", "{action} ; clic droit pour choisir le format", "{action}; clic derecho para elegir el formato"),
    ("retry", "重試", "再試行", "다시 시도", "Réessayer", "Reintentar"),
    ("loading", "載入中…", "読み込み中…", "로드 중…", "Chargement…", "Cargando…"),
    ("load.failed", "載入失敗", "読み込みに失敗しました", "로드 실패", "Échec du chargement", "Error al cargar"),
    ("submit", "提交", "送信", "제출", "Envoyer", "Enviar"),
    ("submitting", "正在提交…", "送信中…", "제출 중…", "Envoi…", "Enviando…"),
    ("next", "下一步", "次へ", "다음", "Suivant", "Siguiente"),
    ("previous", "上一步", "戻る", "이전", "Précédent", "Anterior"),
    ("skip", "跳過", "スキップ", "건너뛰기", "Ignorer", "Omitir"),
    ("delete", "刪除", "削除", "삭제", "Supprimer", "Eliminar"),
    ("edit", "編輯", "編集", "편집", "Modifier", "Editar"),
    ("save", "儲存", "保存", "저장", "Enregistrer", "Guardar"),
    ("search", "搜尋", "検索", "검색", "Rechercher", "Buscar"),
    ("more", "更多", "その他", "더보기", "Plus", "Más"),
    ("collapse", "收合", "折りたたむ", "접기", "Réduire", "Contraer"),
    ("expand", "展開", "展開", "펼치기", "Développer", "Expandir"),
    ("back", "返回", "戻る", "뒤로", "Retour", "Atrás"),
    ("brand.localBuild", "DSH 本機建置", "DSH ローカルビルド", "DSH 로컬 빌드", "Build local DSH", "Build local de DSH"),
    ("unknown", "未知", "不明", "알 수 없음", "Inconnu", "Desconocido"),
    ("none", "無", "なし", "없음", "Aucun", "Ninguno"),
    ("truncated", "已截斷", "切り詰められました", "잘림", "Tronqué", "Truncado"),
    ("json.collapseNode", "收合 JSON 節點", "JSON ノードを折りたたむ", "JSON 노드 접기", "Réduire le nœud JSON", "Contraer nodo JSON"),
    ("json.expandNode", "展開 JSON 節點", "JSON ノードを展開", "JSON 노드 펼치기", "Développer le nœud JSON", "Expandir nodo JSON"),
    ("json.label", "JSON", "JSON", "JSON", "JSON", "JSON"),
    ("markdown.footnotes", "註腳", "脚注", "각주", "Notes de bas de page", "Notas al pie"),
    ("markdown.truncatedCharacters", "… 已截斷，共 {total} 字元", "… {total} 文字で切り詰め", "… {total}자에서 잘림", "… tronqué à {total} caractères", "… truncado a {total} caracteres"),
    ("number.thousand", "{value}K", "{value}K", "{value}K", "{value}K", "{value}K"),
    ("number.million", "{value}M", "{value}M", "{value}M", "{value}M", "{value}M"),
]:
    put("common", key, **{"zh-Hant": zh_hant, "ja": ja, "ko": ko, "fr": fr, "es": es})

for key, zh_hant, ja, ko, fr, es in [
    ("trigger", "設定", "設定", "설정", "Paramètres", "Ajustes"),
    ("title", "設定", "設定", "설정", "Paramètres", "Ajustes"),
    ("close", "關閉", "閉じる", "닫기", "Fermer", "Cerrar"),
    ("openDocument", "開啟設定檔", "設定ファイルを開く", "구성 파일 열기", "Ouvrir le fichier de configuration", "Abrir el archivo de configuración"),
    ("openDocument.error", "無法開啟設定檔", "設定ファイルを開けません", "구성 파일을 열 수 없음", "Impossible d’ouvrir le fichier de configuration", "No se pudo abrir el archivo de configuración"),
    ("general.nav", "一般設定", "一般", "일반", "Général", "General"),
    ("connection.error", "連線異常", "接続エラー", "연결 오류", "Déconnecté", "Desconectado"),
    ("connection.retry", "立即重連", "今すぐ再接続", "지금 다시 연결", "Reconnecter", "Reconectar ahora"),
    ("connection.connecting", "自動重連中", "再接続中", "다시 연결 중", "Reconnexion", "Reconectando"),
    ("connection.connected", "連線成功", "接続しました", "연결됨", "Connecté", "Conectado"),
    ("connection.reconnect", "連線異常，點擊立即重連", "切断されました。クリックして再接続", "연결이 끊겼습니다. 클릭하여 다시 연결", "Déconnecté, reconnecter", "Desconectado, reconectar ahora"),
    ("connection.restart", "連線中斷，正在自動重試，點擊立即重連", "切断されました。自動再試行中。クリックして再接続", "연결이 끊겨 자동으로 재시도 중입니다. 클릭하여 다시 연결", "Reconnexion automatique, reconnecter", "Reconectando automáticamente, reconectar ahora"),
]:
    put("settings", key, **{"zh-Hant": zh_hant, "ja": ja, "ko": ko, "fr": fr, "es": es})

put("settings.locale", "language.title", **{"zh-Hant": "語言", "ja": "言語", "ko": "언어", "fr": "Langue", "es": "Idioma"})

for key, zh_hant, ja, ko, fr, es in [
    ("appearance.title", "外觀", "外観", "모양", "Apparence", "Apariencia"),
    ("appearance.light", "淺色", "ライト", "밝게", "Clair", "Claro"),
    ("appearance.dark", "深色", "ダーク", "어둡게", "Sombre", "Oscuro"),
    ("appearance.system", "跟隨系統", "システムに従う", "시스템 설정", "Système", "Sistema"),
    ("fontSize.title", "字級大小", "フォントサイズ", "글자 크기", "Taille de police", "Tamaño de fuente"),
    ("fontSize.description", "只影響會話內容的字級", "会話本文のサイズのみ変更します", "대화 내용의 글자 크기만 바꿉니다", "Affecte uniquement le contenu de la conversation", "Solo afecta el contenido de la conversación"),
    ("fontSize.unit", "px", "px", "px", "px", "px"),
    ("fontSize.increase", "增大字級", "大きくする", "글자 키우기", "Augmenter", "Aumentar"),
    ("fontSize.decrease", "縮小字級", "小さくする", "글자 줄이기", "Diminuer", "Reducir"),
]:
    put("settings.theme", key, **{"zh-Hant": zh_hant, "ja": ja, "ko": ko, "fr": fr, "es": es})

for key, zh_hant, ja, ko, fr, es in [
    ("session.new", "新會話", "新しいセッション", "새 세션", "Nouvelle session", "Nueva sesión"),
    ("session.new.label", "新增會話", "セッションを作成", "새 세션", "Nouvelle session", "Nueva sesión"),
    ("toggle.open", "開啟側邊欄", "サイドバーを開く", "사이드바 열기", "Ouvrir la barre latérale", "Abrir la barra lateral"),
    ("toggle.collapse", "收合側邊欄", "サイドバーを折りたたむ", "사이드바 접기", "Réduire la barre latérale", "Contraer la barra lateral"),
    ("panels.label", "全域面板", "グローバルパネル", "전역 패널", "Panneaux globaux", "Paneles globales"),
]:
    put("sidebar", key, **{"zh-Hant": zh_hant, "ja": ja, "ko": ko, "fr": fr, "es": es})

for key, zh_hant, ja, ko, fr, es in [
    ("command", "指令", "コマンド", "명령", "Commandes", "Comandos"),
    ("skill", "技能", "スキル", "스킬", "Skills", "Skills"),
    ("subagent", "子智能體", "サブエージェント", "서브에이전트", "Sous-agents", "Subagentes"),
    ("loading", "正在載入…", "読み込み中…", "로드 중…", "Chargement…", "Cargando…"),
    ("drill.aria", "進入目錄", "フォルダを開く", "폴더 열기", "Ouvrir le dossier", "Abrir carpeta"),
    ("drill.hint", "進入目錄", "フォルダを開く", "폴더 열기", "Ouvrir le dossier", "Abrir carpeta"),
    ("drill.key", "Tab", "Tab", "Tab", "Tab", "Tab"),
    ("crumbs.aria", "目錄導覽", "フォルダナビ", "폴더 탐색", "Navigation des dossiers", "Navegación de carpetas"),
    ("suggestions.aria", "觸發候選建議", "候補", "추천 항목", "Suggestions", "Sugerencias"),
]:
    put("slash.menu", key, **{"zh-Hant": zh_hant, "ja": ja, "ko": ko, "fr": fr, "es": es})

# workspace — the sidebar list the user stares at
W = {
    "group.ungrouped": ("未分組", "未分類", "그룹 없음", "Sans groupe", "Sin grupo"),
    "clear.ungrouped": ("清空未分組", "未グループを空にする", "미분류 비우기", "Vider Sans groupe", "Vaciar Sin grupo"),
    "clear.ungrouped.title": ("清空未分組", "未グループを空にする", "미분류 비우기", "Vider Sans groupe", "Vaciar Sin grupo"),
    "clear.ungrouped.desc": ("會封存「未分組」裡的 {n} 個會話，這個分組會隨之清空並消失。會話紀錄與資料夾都會保留。", "「未グループ」の {n} 件のセッションをアーカイブします。グループは空になり消えます。記録とフォルダは残ります。", "「미분류」의 세션 {n}개를 보관 처리합니다. 그룹은 비고 사라집니다. 기록과 폴더는 유지됩니다.", "Archive les {n} sessions de Sans groupe ; le groupe se vide et disparaît. Les journaux et dossiers sont conservés.", "Archiva las {n} sesiones de Sin grupo; el grupo se vacía y desaparece. Los registros y las carpetas se conservan."),
    "clear.ungrouped.pending": ("正在封存會話…", "セッションをアーカイブ中…", "세션 보관 처리 중…", "Archivage des sessions…", "Archivando sesiones…"),
    "session.new": ("新會話", "新しいセッション", "새 세션", "Nouvelle session", "Nueva sesión"),
    "section.workspaces": ("工作區", "ワークスペース", "작업 공간", "Espaces de travail", "Espacios de trabajo"),
    "section.sessions": ("會話", "セッション", "세션", "Sessions", "Sesiones"),
    "viewOptions.label": ("檢視選項", "表示オプション", "보기 옵션", "Options d’affichage", "Opciones de vista"),
    "groupBy.label": ("分組方式", "グループ", "그룹 기준", "Grouper par", "Agrupar por"),
    "groupBy.workspace": ("依工作區", "ワークスペース別", "작업 공간별", "Par espace", "Por espacio"),
    "groupBy.flat": ("單列表", "1 つのリスト", "한 목록", "Liste unique", "Una sola lista"),
    "orderBy.label": ("排序方式", "並び順", "정렬", "Trier par", "Ordenar por"),
    "orderBy.manual": ("手動排序", "手動", "수동", "Manuel", "Manual"),
    "orderBy.updated": ("最近更新", "最終更新", "최근 업데이트", "Dernière mise à jour", "Última actualización"),
    "sessions.expand": ("展開其餘 {n} 個會話", "ほか {n} 件を表示", "세션 {n}개 더 보기", "Afficher {n} sessions de plus", "Mostrar {n} sesiones más"),
    "sessions.collapse": ("收合", "折りたたむ", "접기", "Réduire", "Mostrar menos"),
    "empty.none": ("尚無會話", "セッションはまだありません", "세션이 없습니다", "Aucune session", "Aún no hay sesiones"),
    "empty.noMatches": ("無符合結果", "一致なし", "일치 항목 없음", "Aucun résultat", "Sin coincidencias"),
    "workspace.add": ("新增工作區", "ワークスペースを追加", "작업 공간 추가", "Ajouter un espace", "Añadir espacio"),
    "search.sessions.aria": ("搜尋會話", "セッションを検索", "세션 검색", "Rechercher des sessions", "Buscar sesiones"),
    "search.placeholder": ("搜尋會話…", "セッションを検索…", "세션 검색…", "Rechercher des sessions…", "Buscar sesiones…"),
    "search.clear": ("清除搜尋", "検索をクリア", "검색 지우기", "Effacer la recherche", "Borrar búsqueda"),
    "search.results.aria": ("搜尋結果", "検索結果", "검색 결과", "Résultats", "Resultados"),
    "search.pending": ("正在搜尋會話歷史…", "履歴を検索中…", "세션 기록 검색 중…", "Recherche dans l’historique…", "Buscando en el historial…"),
    "search.unavailable": ("內容搜尋暫不可用，僅顯示名稱符合。", "本文検索は一時利用できません。名前のみ表示します。", "내용 검색을 잠시 사용할 수 없어 이름만 표시합니다.", "La recherche plein texte est indisponible. Noms uniquement.", "La búsqueda de contenido no está disponible. Solo nombres."),
    "search.noMatches": ("無符合會話", "一致するセッションなし", "일치하는 세션 없음", "Aucune session", "Ninguna sesión coincide"),
    "search.hasMore": ("僅顯示前 {n} 筆，請縮小範圍。", "先頭 {n} 件のみ。条件を絞ってください。", "처음 {n}개만 표시합니다. 검색을 좁혀 주세요.", "Affichage des {n} premiers résultats. Affinez la recherche.", "Mostrando los primeros {n} resultados. Afina la búsqueda."),
    "menu.addWorkspace": ("新增工作區…", "ワークスペースを追加…", "작업 공간 추가…", "Ajouter un espace…", "Añadir espacio…"),
    "picker.loading": ("正在載入工作區…", "ワークスペースを読み込み中…", "작업 공간을 로드하는 중…", "Chargement des espaces…", "Cargando espacios…"),
    "conflict.named": ("已有名為「{name}」的工作區。", "「{name}」というワークスペースは既にあります。", "「{name}」 작업 공간이 이미 있습니다.", "Un espace nommé « {name} » existe déjà.", "Ya existe un espacio llamado “{name}”."),
    "folderError.title": ("無法開啟資料夾", "フォルダを開けません", "폴더를 열 수 없음", "Impossible d’ouvrir le dossier", "No se pudo abrir la carpeta"),
    "folderError.retry": ("重新選擇", "選び直す", "다시 선택", "Choisir à nouveau", "Elegir de nuevo"),
    "rename": ("重新命名", "名前を変更", "이름 바꾸기", "Renommer", "Renombrar"),
    "rename.workspace.title": ("重新命名工作區", "ワークスペース名を変更", "작업 공간 이름 바꾸기", "Renommer l’espace", "Renombrar espacio"),
    "rename.session.title": ("重新命名會話", "セッション名を変更", "세션 이름 바꾸기", "Renommer la session", "Renombrar sesión"),
    "field.workspaceName": ("工作區名稱", "ワークスペース名", "작업 공간 이름", "Nom de l’espace", "Nombre del espacio"),
    "field.sessionName": ("會話名稱", "セッション名", "세션 이름", "Nom de la session", "Nombre de la sesión"),
    "delete.workspace": ("刪除工作區", "ワークスペースを削除", "작업 공간 삭제", "Supprimer l’espace", "Eliminar espacio"),
    "delete.desc": ("會把「{name}」從工作區列表移除。資料夾與會話紀錄會保留，其會話會出現在「未分組」。", "「{name}」をリストから外します。フォルダとログは残し、セッションは「未分類」に移ります。", "「{name}」을(를) 목록에서 제거합니다. 폴더와 기록은 남고 세션은 「그룹 없음」으로 갑니다.", "Retire « {name} » de la liste. Le dossier et les journaux restent ; les sessions iront dans Sans groupe.", "Quita “{name}” de la lista. La carpeta y los registros se conservan; las sesiones irán a Sin grupo."),
    "delete.pending": ("正在刪除工作區…", "ワークスペースを削除中…", "작업 공간을 삭제하는 중…", "Suppression de l’espace…", "Eliminando espacio…"),
    "kb.section": ("知識庫", "ナレッジ", "지식 베이스", "Base de connaissances", "Base de conocimiento"),
    "kb.add": ("新增知識庫", "ナレッジを追加", "지식 베이스 추가", "Ajouter une base", "Añadir base"),
    "kb.addHint": ("選擇資料檔或資料夾，應用會建立庫路徑", "ファイルまたはフォルダを選ぶと、アプリがライブラリパスを作ります", "파일이나 폴더를 고르면 앱이 라이브러리 경로를 만듭니다", "Choisissez des fichiers ou dossiers ; l’app crée le chemin", "Elige archivos o carpetas; la app crea la ruta"),
    "kb.settings": ("設定", "設定", "설정", "Paramètres", "Ajustes"),
    "kb.ingest": ("新增資料", "資料を追加", "자료 추가", "Ajouter des fichiers", "Añadir archivos"),
    "kb.rebuild": ("更新索引", "索引を更新", "인덱스 업데이트", "Mettre à jour l’index", "Actualizar índice"),
    "kb.default": ("設為預設", "デフォルトにする", "기본으로 설정", "Définir par défaut", "Establecer como predeterminada"),
    "kb.delete": ("刪除知識庫", "ナレッジを削除", "지식 베이스 삭제", "Supprimer la base", "Eliminar base"),
    "kb.delete.desc": ("會刪除「{name}」的庫資料夾和索引。你選的原始資料不會動。", "「{name}」のライブラリと索引を削除します。元の資料は触れません。", "「{name}」 라이브러리 폴더와 인덱스를 삭제합니다. 원본은 그대로입니다.", "Supprime le dossier et l’index de « {name} ». Vos fichiers d’origine restent.", "Elimina la carpeta y el índice de “{name}”. Tus materiales originales no se tocan."),
    "kb.delete.pending": ("正在刪除知識庫…", "ナレッジを削除中…", "지식 베이스를 삭제하는 중…", "Suppression de la base…", "Eliminando base…"),
    "menu.fork": ("分叉會話", "セッションをフォーク", "세션 포크", "Dupliquer la session", "Bifurcar sesión"),
    "menu.archiveSession": ("封存會話", "セッションをアーカイブ", "세션 보관", "Archiver la session", "Archivar sesión"),
    "sessions.count.one": ("{n} 個會話", "{n} 件のセッション", "세션 {n}개", "{n} session", "{n} sesión"),
    "sessions.count.other": ("{n} 個會話", "{n} 件のセッション", "세션 {n}개", "{n} sessions", "{n} sesiones"),
    "actions.workspace.aria": ("工作區「{name}」的操作", "ワークスペース「{name}」の操作", "작업 공간 「{name}」 작업", "Actions de l’espace {name}", "Acciones del espacio {name}"),
    "actions.ungrouped.aria": ("「未分組」的操作", "「未グループ」の操作", "「미분류」 작업", "Actions de Sans groupe", "Acciones de Sin grupo"),
    "actions.session.aria": ("會話「{name}」的操作", "セッション「{name}」の操作", "세션 「{name}」 작업", "Actions de la session {name}", "Acciones de la sesión {name}"),
    "actions.newSession.aria": ("在「{name}」中新增會話", "「{name}」で新しいセッション", "「{name}」에서 새 세션", "Nouvelle session dans {name}", "Nueva sesión en {name}"),
    "status.running": ("進行中", "実行中", "실행 중", "En cours", "En curso"),
    "status.subagentsRunning.one": ("{n} 個子代理執行中", "サブエージェント {n} 件が実行中", "서브에이전트 {n}개 실행 중", "{n} sous-agent en cours", "{n} subagente en curso"),
    "status.subagentsRunning.other": ("{n} 個子代理執行中", "サブエージェント {n} 件が実行中", "서브에이전트 {n}개 실행 중", "{n} sous-agents en cours", "{n} subagentes en curso"),
    "status.idle": ("閒置", "待機中", "유휴", "Inactif", "Inactivo"),
    "status.waitingApproval": ("等待核准", "承認待ち", "승인 대기", "En attente d’approbation", "Esperando aprobación"),
    "status.planReview": ("計畫待審", "プラン審査待ち", "계획 검토 대기", "Plan à revoir", "Plan por revisar"),
    "status.waitingAnswer": ("等待回答", "回答待ち", "답변 대기", "En attente de réponse", "Esperando respuesta"),
    "status.completed": ("已完成", "完了", "완료", "Terminé", "Completado"),
    "schedule.active": ("有活動的排程任務", "実行中のスケジュールあり", "활성 예약 작업 있음", "Tâche planifiée active", "Hay una tarea programada"),
    "hover.created": ("建立於 {time}", "{time} に作成", "{time}에 생성", "Créé {time}", "Creado {time}"),
    "hover.copied": ("已複製", "コピーしました", "복사됨", "Copié", "Copiado"),
    "date.ymd": ("{y}年{m}月{d}日", "{y}/{m}/{d}", "{y}년 {m}월 {d}일", "{y}-{m}-{d}", "{y}-{m}-{d}"),
    "time.now": ("剛剛", "たった今", "방금", "à l’instant", "ahora"),
    "time.minutes": ("{n}分鐘", "{n}分", "{n}분", "{n} min", "{n} min"),
    "time.hours": ("{n}小時", "{n}時間", "{n}시간", "{n} h", "{n} h"),
    "time.days": ("{n}天", "{n}日", "{n}일", "{n} j", "{n} d"),
    "time.months": ("{n}個月", "{n}か月", "{n}개월", "{n} mois", "{n} mes"),
    "time.years": ("{n}年", "{n}年", "{n}년", "{n} an", "{n} a"),
    "time.ago": ("{t}前", "{t}前", "{t} 전", "il y a {t}", "hace {t}"),
}
for key, vals in W.items():
    put("workspace", key, **{"zh-Hant": vals[0], "ja": vals[1], "ko": vals[2], "fr": vals[3], "es": vals[4]})

M = {
    "command.description": ("選擇本會話使用的模型", "この会話で使うモデルを選ぶ", "이 대화에 쓸 모델 선택", "Choisir le modèle de cette conversation", "Elegir el modelo de esta conversación"),
    "option.loadError": ("目錄載入失敗：{message}", "カタログの読み込みに失敗：{message}", "목록을 불러오지 못함: {message}", "Échec du catalogue : {message}", "Error al cargar el catálogo: {message}"),
    "option.deepseekV4Flash.description": ("快速、有效率且較省；適合目標明確、常規或並行任務。", "速くて効率的。明確・定型・並列向き。", "빠르고 효율적이며 경제적입니다. 목표가 분명하거나 일상·병렬 작업에 맞습니다.", "Rapide et économique ; tâches ciblées, courantes ou parallèles.", "Rápido y económico; tareas claras, rutinarias o en paralelo."),
    "option.deepseekV4Pro.description": ("更強的自主編碼、知識與複雜推理；適合複雜或品質優先的任務，但成本更高。", "より強い自律コーディングと推論。複雑・品質重視向きでコストは高め。", "자율 코딩·지식·복잡한 추론이 더 강합니다. 복잡하거나 품질이 중요한 작업에 맞지만 비용이 높습니다.", "Meilleur coding agentique et raisonnement ; tâches complexes, coût plus élevé.", "Mejor coding agéntico y razonamiento; tareas complejas, mayor coste."),
    "trigger.fallback": ("選擇模型", "モデルを選択", "모델 선택", "Choisir un modèle", "Elegir modelo"),
    "trigger.loading": ("正在載入模型…", "モデルを読み込み中…", "모델을 로드하는 중…", "Chargement des modèles…", "Cargando modelos…"),
    "trigger.selectAria": ("選擇模型", "モデルを選択", "모델 선택", "Choisir un modèle", "Elegir modelo"),
    "trigger.aria": ("選擇模型，目前 {model}", "モデルを選択、現在 {model}", "모델 선택, 현재 {model}", "Modèle, actuel {model}", "Modelo, actual {model}"),
    "trigger.ariaEffort": ("選擇模型，目前 {model}，推理等級 {effort}", "モデルを選択、現在 {model}、推論 {effort}", "모델 선택, 현재 {model}, 추론 {effort}", "Modèle {model}, effort {effort}", "Modelo {model}, esfuerzo {effort}"),
    "menu.aria": ("模型與推理等級", "モデルと推論レベル", "모델과 추론 수준", "Modèle et effort", "Modelo y esfuerzo"),
    "menu.model": ("模型", "モデル", "모델", "Modèle", "Modelo"),
    "menu.effort": ("推理等級", "推論レベル", "추론 수준", "Effort", "Esfuerzo"),
    "effort.providerDefault": ("Default", "Default", "Default", "Default", "Default"),
    "status.loading": ("正在重新整理模型列表…", "モデル一覧を更新中…", "모델 목록을 새로고침하는 중…", "Actualisation de la liste…", "Actualizando la lista…"),
    "error.action": ("模型操作失敗：{message}", "モデル操作に失敗：{message}", "모델 작업 실패: {message}", "Échec de l’opération : {message}", "Error de la operación: {message}"),
    "action.reload": ("重新載入", "再読み込み", "다시 로드", "Recharger", "Recargar"),
    "warning.groupLoad": ("{name} 載入失敗：{message}", "{name} の読み込みに失敗：{message}", "{name} 로드 실패: {message}", "Échec de {name} : {message}", "Error al cargar {name}: {message}"),
    "empty.models": ("沒有可用的模型。", "利用できるモデルがありません。", "사용할 수 있는 모델이 없습니다.", "Aucun modèle disponible.", "No hay modelos disponibles."),
    "blocked.composer": ("目前模型不可用，請先選擇模型", "このモデルは使えません。別のモデルを選んでください", "이 모델은 사용할 수 없습니다. 먼저 모델을 선택하세요", "Ce modèle est indisponible — choisissez-en un", "Este modelo no está disponible; elige otro"),
    "empty.efforts": ("目前模型未提供推理等級。", "このモデルに推論レベルはありません。", "이 모델은 추론 수준을 제공하지 않습니다.", "Ce modèle n’expose aucun niveau d’effort.", "Este modelo no ofrece niveles de esfuerzo."),
}
for key, vals in M.items():
    put("model", key, **{"zh-Hant": vals[0], "ja": vals[1], "ko": vals[2], "fr": vals[3], "es": vals[4]})

# verify against catalog
missing = []
for lang, nss in chrome.items():
    for ns, dict_ in nss.items():
        want = set(cat[ns]["zh"])
        have = set(dict_)
        if want != have:
            missing.append((lang, ns, sorted(want - have), sorted(have - want)))
if missing:
    for row in missing:
        print("MISMATCH", row)
    raise SystemExit(1)

out = root / "lib" / "chrome-dicts.json"
out.write_text(json.dumps(chrome, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("wrote", out, "langs", list(chrome), "namespaces", sorted({ns for nss in chrome.values() for ns in nss}))