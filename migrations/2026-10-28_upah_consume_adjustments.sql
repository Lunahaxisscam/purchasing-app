-- Atomic consumption of signed rights; never creates a cash/payment/project-cost row.
CREATE OR REPLACE FUNCTION public.upah_consume_adjustments(p_destination_totalan_id uuid,p_adjustment_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d public.upah_totalan%ROWTYPE; n integer; amt numeric; expected integer; current_ids uuid[];
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND role='admin') THEN
  RAISE EXCEPTION 'admin_required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO d FROM upah_totalan WHERE id=p_destination_totalan_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'totalan_not_found' USING ERRCODE='P0002'; END IF;
 SELECT array_agg(id ORDER BY id) INTO current_ids FROM upah_penyesuaian WHERE destination_totalan_id=d.id AND status='CONSUMED';
 IF current_ids IS NOT NULL THEN
  IF current_ids=(SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(p_adjustment_ids) x) THEN
   RETURN jsonb_build_object('status','REPLAY','opening_adjustment',d.opening_adjustment);
  END IF;
  RAISE EXCEPTION 'destination_already_adjusted' USING ERRCODE='22023';
 END IF;
 IF d.final OR COALESCE(d.carried_residual,0)<>0 OR COALESCE(d.opening_adjustment,0)<>0 THEN
  RAISE EXCEPTION 'destination_final_or_adjusted' USING ERRCODE='42501';
 END IF;
 expected:=cardinality(p_adjustment_ids);
 IF expected IS NULL OR expected=0 OR expected<>(SELECT count(DISTINCT x) FROM unnest(p_adjustment_ids) x) THEN
  RAISE EXCEPTION 'invalid_adjustment_ids' USING ERRCODE='22023';
 END IF;
 PERFORM id FROM upah_penyesuaian WHERE id=ANY(p_adjustment_ids) ORDER BY id FOR UPDATE;
 SELECT count(*),sum(a.nominal) INTO n,amt FROM upah_penyesuaian a JOIN upah_totalan s ON s.id=a.source_totalan_id
 WHERE a.id=ANY(p_adjustment_ids) AND a.tukang_id=d.tukang_id AND a.status='ACTIVE' AND a.destination_totalan_id IS NULL
 AND s.id<>d.id AND s.seq<d.seq AND s.final AND s.saldo_akhir=0;
 IF n<>expected THEN RAISE EXCEPTION 'adjustment_unavailable_or_invalid_source' USING ERRCODE='22023'; END IF;
 UPDATE upah_totalan SET opening_adjustment=amt, hak_bersih=total_upah-kasbon_dipotong+amt,
  saldo_akhir=total_upah-kasbon_dipotong+amt-pembayaran_aktual,
  status=CASE WHEN total_upah-kasbon_dipotong+amt-pembayaran_aktual=0 THEN 'Lunas' ELSE 'Perlu cek' END,updated_at=now()
 WHERE id=d.id;
 UPDATE upah_penyesuaian SET status='CONSUMED',destination_totalan_id=d.id,consumed_at=now(),updated_at=now() WHERE id=ANY(p_adjustment_ids);
 INSERT INTO activity_logs(user_id,user_email,action,entity,entity_id,detail)
 VALUES(auth.uid(),COALESCE(auth.jwt()->>'email','admin'),'UPAH_CONSUME_ADJUSTMENTS','upah_totalan',d.id::text,
 jsonb_build_object('adjustment_ids',p_adjustment_ids,'nominal',amt)::text);
 RETURN jsonb_build_object('status','SUCCESS','opening_adjustment',amt,'destination_totalan_id',d.id);
END $$;
REVOKE ALL ON FUNCTION public.upah_consume_adjustments(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.upah_consume_adjustments(uuid,uuid[]) TO authenticated;
